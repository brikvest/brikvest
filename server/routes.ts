import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { setupAuth, hashPassword, comparePasswords } from "./auth";
import passport from "passport";
import { randomBytes } from "crypto";
import { upload, uploadToCloudinary } from "./cloudinary";
import { sendEmail } from "./emailService";
import { 
  investmentEmailTemplate, 
  kycApprovedEmailTemplate, 
  kycRejectedEmailTemplate,
  investmentCreatedEmailTemplate,
  paymentReceivedEmailTemplate,
  investmentConfirmedEmailTemplate
} from "./emailTemplates";
import { getExchangeRates, convertCurrency, formatCurrency, detectUserCurrency, CURRENCY_CONFIG, getCurrencyFromCountry } from "./currencyService";
import { 
  insertInvestmentReservationSchema, 
  insertPropertySchema,
  insertInvestmentGroupSchema,
  insertGroupMembershipSchema,
  insertPropertyVerificationChecklistSchema,
  insertVerificationStepCompletionSchema,
  loginSchema,
  loginUserSchema,
  registerUserSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  kycSubmissionSchema,
  type Property,
  type InvestmentReservation,
  type InvestmentGroup,
  type GroupMembership,
  type VerificationStep,
  type PropertyVerificationChecklist,
  type VerificationStepCompletion
} from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";

// Simple session store for admin authentication
const adminSessions = new Map<string, { userId: number; username: string; role: string; expiresAt: number }>();

// Authentication middleware
function requireAdminAuth(req: any, res: any, next: any) {
  const sessionId = req.headers.authorization?.replace('Bearer ', '');
  
  if (!sessionId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  const session = adminSessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    if (session) adminSessions.delete(sessionId);
    return res.status(401).json({ message: "Invalid or expired session" });
  }
  
  if (session.role !== 'admin' && session.role !== 'super_admin') {
    return res.status(403).json({ message: "Admin access required" });
  }
  
  req.user = session;
  next();
}

// Authentication middleware
function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Authentication required" });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup email/password authentication
  setupAuth(app);

  // User authentication routes
  app.post('/api/register', async (req, res) => {
    try {
      const result = registerUserSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: "Invalid registration data", 
          details: result.error.errors 
        });
      }

      const { email, password, firstName, lastName, phone } = result.data;
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists with this email" });
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        emailVerified: true, // Auto-verify for now
      });

      // Auto-login after registration
      req.login(user, (err: any) => {
        if (err) return res.status(500).json({ message: "Registration successful but login failed" });
        const { password: _, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post('/api/login', passport.authenticate('local'), (req, res) => {
    const { password: _, ...userWithoutPassword } = req.user as any;
    res.json(userWithoutPassword);
  });

  app.post('/api/logout', (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get('/api/auth/user', requireAuth, (req, res) => {
    const { password: _, ...userWithoutPassword } = req.user as any;
    res.json(userWithoutPassword);
  });

  // User-specific investment data
  app.get('/api/user/investments', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const investments = await storage.getReservationsByUserId(userId);
      res.json(investments);
    } catch (error) {
      console.error("Error fetching user investments:", error);
      res.status(500).json({ message: "Failed to fetch investments" });
    }
  });

  app.get('/api/user/reservations', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const reservations = await storage.getReservationsByUserId(userId);
      
      // Fetch property details for each reservation
      const reservationsWithProperties = await Promise.all(
        reservations.map(async (reservation: any) => {
          const property = await storage.getProperty(reservation.propertyId);
          return {
            ...reservation,
            property
          };
        })
      );
      
      res.json(reservationsWithProperties);
    } catch (error) {
      console.error("Error fetching user reservations:", error);
      res.status(500).json({ message: "Failed to fetch reservations" });
    }
  });

  app.get('/api/user/stats', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const investments = await storage.getReservationsByUserId(userId);
      
      const totalInvested = investments.reduce((sum: number, inv: any) => sum + (inv.units * 32353), 0);
      const activeInvestments = investments.length;
      const expectedReturns = totalInvested * 0.15; // 15% expected annual return
      
      res.json({
        totalInvested,
        activeInvestments,
        expectedReturns
      });
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ message: "Failed to fetch user statistics" });
    }
  });

  // KYC submission endpoint
  app.post('/api/kyc/submit', requireAuth, upload.fields([
    { name: 'idDocument', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
    { name: 'signature', maxCount: 1 }
  ]), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      // Validate request body using Zod schema
      const validationResult = kycSubmissionSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validationResult.error.errors 
        });
      }

      const { fullName, dateOfBirth, address, occupation, idType, idNumber } = validationResult.data;

      // Get existing KYC data to check if user is updating
      const existingUser = await storage.getUser(userId);
      const hasExistingIdDocument = !!existingUser?.kycIdDocumentUrl;
      const hasExistingSignature = !!existingUser?.kycSignatureUrl;

      // Validate file uploads - only required if user doesn't already have them
      if (!files || (!files.idDocument || files.idDocument.length === 0)) {
        if (!hasExistingIdDocument) {
          return res.status(400).json({ error: "ID document is required" });
        }
      }

      if (!files.signature || files.signature.length === 0) {
        if (!hasExistingSignature) {
          return res.status(400).json({ error: "Signature image is required" });
        }
      }

      // Validate and upload files only if provided
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/heic', 'image/heif'];
      const maxFileSize = 10 * 1024 * 1024; // 10MB
      
      // Upload ID document if provided
      let idDocumentUrl = existingUser?.kycIdDocumentUrl || null;
      if (files.idDocument && files.idDocument.length > 0) {
        const idDocumentFile = files.idDocument[0];
        
        if (!allowedMimeTypes.includes(idDocumentFile.mimetype)) {
          return res.status(400).json({ 
            error: "Invalid file type for ID document. Only JPEG, PNG, WEBP, and HEIC images are allowed." 
          });
        }

        if (idDocumentFile.size > maxFileSize) {
          return res.status(400).json({ 
            error: "ID document file size exceeds 10MB limit." 
          });
        }

        const idDocumentResult = await uploadToCloudinary(
          idDocumentFile.buffer,
          idDocumentFile.originalname,
          'brikvest/kyc/documents'
        );
        idDocumentUrl = idDocumentResult.url;
      }

      // Upload signature if provided
      let signatureUrl = existingUser?.kycSignatureUrl || null;
      if (files.signature && files.signature.length > 0) {
        const signatureFile = files.signature[0];
        
        if (!allowedMimeTypes.includes(signatureFile.mimetype)) {
          return res.status(400).json({ 
            error: "Invalid file type for signature. Only JPEG, PNG, WEBP, and HEIC images are allowed." 
          });
        }
        
        if (signatureFile.size > 5 * 1024 * 1024) { // 5MB max
          return res.status(400).json({ 
            error: "Signature file size exceeds 5MB limit." 
          });
        }
        
        const signatureResult = await uploadToCloudinary(
          signatureFile.buffer,
          signatureFile.originalname,
          'brikvest/kyc/signatures'
        );
        signatureUrl = signatureResult.url;
      }

      // Upload selfie if provided
      let selfieUrl = existingUser?.kycSelfieUrl || null;
      if (files.selfie && files.selfie.length > 0) {
        const selfieFile = files.selfie[0];
        
        if (!allowedMimeTypes.includes(selfieFile.mimetype)) {
          return res.status(400).json({ 
            error: "Invalid file type for selfie. Only JPEG, PNG, WEBP, and HEIC images are allowed." 
          });
        }
        
        if (selfieFile.size > maxFileSize) {
          return res.status(400).json({ 
            error: "Selfie file size exceeds 10MB limit." 
          });
        }
        
        const selfieResult = await uploadToCloudinary(
          selfieFile.buffer,
          selfieFile.originalname,
          'brikvest/kyc/selfies'
        );
        selfieUrl = selfieResult.url;
      }

      // Update user's KYC information
      await storage.updateUserKyc(userId, {
        kycFullName: fullName,
        kycDateOfBirth: new Date(dateOfBirth),
        kycAddress: address,
        kycOccupation: occupation,
        kycIdType: idType,
        kycIdNumber: idNumber,
        kycIdDocumentUrl: idDocumentUrl,
        kycSelfieUrl: selfieUrl,
        kycSignatureUrl: signatureUrl,
        kycStatus: 'submitted',
        kycSubmittedAt: new Date(),
      });

      res.json({ 
        message: "KYC submitted successfully",
        status: "submitted"
      });
    } catch (error) {
      console.error("Error submitting KYC:", error);
      res.status(500).json({ error: "Failed to submit KYC verification" });
    }
  });

  // Admin KYC routes
  app.get('/api/admin/kyc/submissions', requireAdminAuth, async (req, res) => {
    try {
      const submissions = await storage.getAllKycSubmissions();
      res.json(submissions);
    } catch (error) {
      console.error("Error fetching KYC submissions:", error);
      res.status(500).json({ error: "Failed to fetch KYC submissions" });
    }
  });

  app.put('/api/admin/kyc/:userId/status', requireAdminAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { status } = req.body;

      if (!['verified', 'rejected'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'verified' or 'rejected'" });
      }

      // Get user info before updating status
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Update KYC status
      await storage.updateUserKycStatus(userId, status);

      // Send appropriate email
      try {
        const fullName = user.kycFullName || user.email.split('@')[0];
        
        if (status === 'verified') {
          const emailContent = kycApprovedEmailTemplate({ fullName });
          await sendEmail({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
        } else if (status === 'rejected') {
          const emailContent = kycRejectedEmailTemplate({ fullName });
          await sendEmail({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
        }
      } catch (emailError) {
        console.error("Error sending KYC status email:", emailError);
        // Don't fail the request if email fails
      }

      res.json({ message: `KYC status updated to ${status}` });
    } catch (error) {
      console.error("Error updating KYC status:", error);
      res.status(500).json({ error: "Failed to update KYC status" });
    }
  });

  // Admin Investment routes (admin-assisted flow)
  // Search for user by email
  app.post('/api/admin/users/search', requireAdminAuth, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      res.json({ user: user || null });
    } catch (error) {
      console.error("Error searching for user:", error);
      res.status(500).json({ error: "Failed to search for user" });
    }
  });

  // Create new user account (admin-assisted)
  app.post('/api/admin/users/create', requireAdminAuth, async (req, res) => {
    try {
      const { email, fullName, phone } = req.body;
      
      if (!email || !fullName) {
        return res.status(400).json({ error: "Email and full name are required" });
      }

      // Check if user already exists
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: "User with this email already exists" });
      }

      // Create user with temporary password
      const tempPassword = randomBytes(16).toString('hex');
      const hashedPassword = await hashPassword(tempPassword);
      
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName: fullName.split(' ')[0],
        lastName: fullName.split(' ').slice(1).join(' ') || '',
        phone: phone || '',
      });

      res.status(201).json({ user });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Create investment reservation (admin-assisted)
  app.post('/api/admin/investments/create', requireAdminAuth, async (req, res) => {
    try {
      const {
        userId,
        propertyId,
        units,
        paymentMethod,
        paymentReference,
        paymentEvidenceUrl,
        notes
      } = req.body;

      if (!userId || !propertyId || !units) {
        return res.status(400).json({ error: "userId, propertyId, and units are required" });
      }

      // Get user and property
      const user = await storage.getUser(userId);
      const property = await storage.getProperty(propertyId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      // Calculate available units - use totalSlots/availableSlots if available (legacy system)
      const availableUnits = (property.totalSlots && property.totalSlots > 0)
        ? (property.availableSlots || 0)
        : (property.totalUnits || 0) - (property.reservedUnits || 0) - (property.soldUnits || 0);
      
      if (units > availableUnits) {
        return res.status(400).json({ 
          error: `Not enough units available. Only ${availableUnits} units remaining.` 
        });
      }

      // Calculate amount - use unitPrice if available, otherwise use minInvestment
      const unitPriceSnapshot = property.unitPrice || property.minInvestment || 0;
      const amount = Math.round(units * unitPriceSnapshot);

      // Create reservation
      const reservation = await storage.createInvestmentReservation({
        userId,
        propertyId,
        fullName: user.kycFullName || `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.phone || '',
        units: units.toString(),
        amount,
        currency: property.currency || 'USD',
        unitPriceSnapshot,
        status: 'payment_pending',
        paymentMethod: paymentMethod || null,
        paymentReference: paymentReference || null,
        paymentEvidenceUrl: paymentEvidenceUrl || null,
        createdByAdminId: (req.user as any).userId,
        notes: notes || null,
      });

      // Update property reserved units
      await storage.updatePropertyUnitCounts(propertyId, units, 0);

      // Send email to user
      try {
        const emailContent = investmentCreatedEmailTemplate({
          fullName: reservation.fullName,
          propertyName: property.name,
          units,
          amount,
          currency: property.currency || 'USD',
        });
        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html,
        });
      } catch (emailError) {
        console.error("Error sending investment created email:", emailError);
      }

      res.status(201).json(reservation);
    } catch (error) {
      console.error("Error creating admin investment:", error);
      res.status(500).json({ error: "Failed to create investment" });
    }
  });

  // Mark payment as received
  app.put('/api/admin/investments/:id/mark-payment-received', requireAdminAuth, async (req, res) => {
    try {
      const reservationId = parseInt(req.params.id);
      const { paymentMethod, paymentReference, paymentEvidenceUrl, amount } = req.body;

      const reservation = await storage.getReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ error: "Reservation not found" });
      }

      // Update reservation status
      await storage.updateReservation(reservationId, {
        status: 'payment_received',
        paymentMethod: paymentMethod || reservation.paymentMethod,
        paymentReference: paymentReference || reservation.paymentReference,
        paymentEvidenceUrl: paymentEvidenceUrl || reservation.paymentEvidenceUrl,
      });

      // Create payment record
      await storage.createInvestmentPayment({
        reservationId,
        amount: amount || reservation.amount,
        currency: reservation.currency,
        paymentMethod: paymentMethod || reservation.paymentMethod || 'bank_transfer',
        paymentReference: paymentReference || reservation.paymentReference,
        paymentEvidenceUrl: paymentEvidenceUrl || reservation.paymentEvidenceUrl,
        recordedByAdminId: (req.user as any).userId,
        status: 'received',
      });

      // Get property for email
      const property = await storage.getProperty(reservation.propertyId);
      
      // Send email to user
      if (property) {
        try {
          const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
          const emailContent = paymentReceivedEmailTemplate({
            fullName: reservation.fullName,
            propertyName: property.name,
            units,
            amount: amount || reservation.amount,
            currency: reservation.currency,
            paymentReference: paymentReference || reservation.paymentReference || undefined,
          });
          await sendEmail({
            to: reservation.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
        } catch (emailError) {
          console.error("Error sending payment received email:", emailError);
        }
      }

      res.json({ message: "Payment marked as received" });
    } catch (error) {
      console.error("Error marking payment as received:", error);
      res.status(500).json({ error: "Failed to mark payment as received" });
    }
  });

  // Confirm investment (validates KYC and moves to confirmed)
  app.put('/api/admin/investments/:id/confirm', requireAdminAuth, async (req, res) => {
    try {
      const reservationId = parseInt(req.params.id);

      const reservation = await storage.getReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ error: "Reservation not found" });
      }

      // Check KYC status
      if (reservation.userId) {
        const user = await storage.getUser(reservation.userId);
        if (user && user.kycStatus !== 'verified') {
          return res.status(400).json({ 
            error: "Cannot confirm investment. User KYC must be verified first." 
          });
        }
      }

      // Update reservation to confirmed
      await storage.updateReservation(reservationId, {
        status: 'confirmed'
      });

      // Move units from reserved to sold
      const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
      await storage.updatePropertyUnitCounts(reservation.propertyId, -units, units);

      // Get property for email
      const property = await storage.getProperty(reservation.propertyId);
      
      // Send email to user
      if (property) {
        try {
          const emailContent = investmentConfirmedEmailTemplate({
            fullName: reservation.fullName,
            propertyName: property.name,
            units,
            amount: reservation.amount,
            currency: reservation.currency,
          });
          await sendEmail({
            to: reservation.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
        } catch (emailError) {
          console.error("Error sending investment confirmed email:", emailError);
        }
      }

      res.json({ message: "Investment confirmed successfully" });
    } catch (error) {
      console.error("Error confirming investment:", error);
      res.status(500).json({ error: "Failed to confirm investment" });
    }
  });

  // Update investment reservation details
  app.put('/api/admin/investments/:id', requireAdminAuth, async (req, res) => {
    try {
      const reservationId = parseInt(req.params.id);
      const { units, paymentMethod, paymentReference, paymentEvidenceUrl, notes } = req.body;

      const reservation = await storage.getReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ error: "Reservation not found" });
      }

      const property = await storage.getProperty(reservation.propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      // If units are being changed, validate and update property counts
      if (units !== undefined) {
        const oldUnits = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
        const newUnits = parseFloat(units);
        const unitsDelta = newUnits - oldUnits;

        if (unitsDelta !== 0) {
          // Check availability if increasing units
          if (unitsDelta > 0) {
            const availableUnits = (property.totalSlots && property.totalSlots > 0)
              ? (property.availableSlots || 0)
              : (property.totalUnits || 0) - (property.reservedUnits || 0) - (property.soldUnits || 0);
            
            if (unitsDelta > availableUnits) {
              return res.status(400).json({ 
                error: `Not enough units available. Only ${availableUnits} additional units available.` 
              });
            }
          }

          // Update property unit counts
          await storage.updatePropertyUnitCounts(reservation.propertyId, unitsDelta, 0);
        }

        // Recalculate amount based on new units
        const unitPriceSnapshot = property.unitPrice || property.minInvestment || 0;
        const amount = Math.round(newUnits * unitPriceSnapshot);

        // Update reservation
        const updated = await storage.updateReservation(reservationId, {
          units: units.toString(),
          amount,
          paymentMethod: paymentMethod !== undefined ? paymentMethod : reservation.paymentMethod,
          paymentReference: paymentReference !== undefined ? paymentReference : reservation.paymentReference,
          paymentEvidenceUrl: paymentEvidenceUrl !== undefined ? paymentEvidenceUrl : reservation.paymentEvidenceUrl,
          notes: notes !== undefined ? notes : reservation.notes,
        });

        return res.json(updated);
      }

      // Update without changing units
      const updated = await storage.updateReservation(reservationId, {
        paymentMethod: paymentMethod !== undefined ? paymentMethod : reservation.paymentMethod,
        paymentReference: paymentReference !== undefined ? paymentReference : reservation.paymentReference,
        paymentEvidenceUrl: paymentEvidenceUrl !== undefined ? paymentEvidenceUrl : reservation.paymentEvidenceUrl,
        notes: notes !== undefined ? notes : reservation.notes,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating investment:", error);
      res.status(500).json({ error: "Failed to update investment" });
    }
  });

  // Cancel investment reservation
  app.put('/api/admin/investments/:id/cancel', requireAdminAuth, async (req, res) => {
    try {
      const reservationId = parseInt(req.params.id);

      const reservation = await storage.getReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ error: "Reservation not found" });
      }

      // Update reservation to cancelled
      await storage.updateReservation(reservationId, {
        status: 'cancelled'
      });

      // If units were reserved, release them
      if (reservation.status === 'payment_pending' || reservation.status === 'payment_received') {
        const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
        await storage.updatePropertyUnitCounts(reservation.propertyId, -units, 0);
      }

      res.json({ message: "Investment cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling investment:", error);
      res.status(500).json({ error: "Failed to cancel investment" });
    }
  });

  // Password reset routes
  app.post('/api/forgot-password', async (req, res) => {
    try {
      const result = forgotPasswordSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: "Invalid email", 
          details: result.error.errors 
        });
      }

      const { email } = result.data;
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Don't reveal if email exists for security
        return res.json({ message: "If the email exists, a reset link has been sent" });
      }

      // Generate reset token
      const resetToken = randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 3600000); // 1 hour from now
      
      await storage.setPasswordResetToken(email, resetToken, expiry);

      // Send reset email
      const resetLink = `https://www.brikvest.net/reset-password?token=${resetToken}`;
      await sendEmail({
        to: email,
        subject: "Password Reset - Brikvest",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Brikvest Password Reset</h1>
            </div>
            <div style="background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px;">
              <h2 style="color: #374151; margin-bottom: 20px;">Reset Your Password</h2>
              <p style="color: #6b7280; margin-bottom: 20px;">
                We received a request to reset your password for your Brikvest account. 
                Click the button below to set a new password:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" style="background-color: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Reset My Password
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Or copy and paste this link into your browser:
              </p>
              <p style="color: #3b82f6; font-size: 14px; word-break: break-all; margin-bottom: 20px;">
                ${resetLink}
              </p>
              <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  This link will expire in 1 hour for security reasons.<br>
                  If you didn't request this password reset, please ignore this email.
                </p>
              </div>
            </div>
          </div>
        `
      });

      res.json({ message: "If the email exists, a reset link has been sent" });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  app.post('/api/reset-password', async (req, res) => {
    try {
      const result = resetPasswordSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: "Invalid reset data", 
          details: result.error.errors 
        });
      }

      const { token, password } = result.data;
      const user = await storage.getUserByResetToken(token);
      
      if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      // Update password and clear reset token
      const hashedPassword = await hashPassword(password);
      await storage.updateUserPassword(user.id, hashedPassword);
      await storage.updateUser(user.id, { resetToken: null, resetTokenExpiry: null });

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });
  // Admin authentication routes
  app.post("/api/admin/login", async (req, res) => {
    try {
      const result = loginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: "Invalid login data", 
          details: result.error.errors 
        });
      }

      const { username, password } = result.data;
      const user = await storage.getAdminUserByUsername(username);

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isValidPassword = await comparePasswords(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Update last login
      await storage.updateAdminUserLastLogin(user.id);

      // Create session
      const sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

      adminSessions.set(sessionId, {
        userId: user.id,
        username: user.username,
        role: user.role,
        expiresAt
      });

      res.json({
        sessionId,
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    const sessionId = req.headers.authorization?.replace('Bearer ', '');
    if (sessionId) {
      adminSessions.delete(sessionId);
    }
    res.json({ message: "Logged out successfully" });
  });

  app.get("/api/admin/me", requireAdminAuth, (req: any, res) => {
    res.json({
      user: {
        id: req.user.userId,
        username: req.user.username,
        role: req.user.role
      }
    });
  });

  // Get all properties
  app.get("/api/properties", async (req, res) => {
    try {
      const properties = await storage.getProperties();
      res.json(properties);
    } catch (error) {
      console.error("Error fetching properties:", error);
      res.status(500).json({ message: "Failed to fetch properties" });
    }
  });

  // Get investment statistics
  app.get("/api/statistics", async (req, res) => {
    try {
      const reservations = await storage.getAllReservations();
      const properties = await storage.getProperties();
      
      // Calculate total invested amount
      const totalInvested = reservations.reduce((sum, reservation) => {
        const property = properties.find(p => p.id === reservation.propertyId);
        const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
        return sum + (property ? units * property.minInvestment : 0);
      }, 0);
      
      // Count unique investors
      const uniqueInvestors = new Set(reservations.map(r => r.email)).size;
      
      res.json({
        totalInvested,
        activeInvestors: uniqueInvestors,
        avgReturn: 15.2
      });
    } catch (error) {
      console.error("Error fetching statistics:", error);
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Get property by ID (excludes archived properties for non-admin users)
  app.get("/api/properties/:id", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      // Hide archived properties from non-admin users
      const sessionId = req.headers.authorization?.replace('Bearer ', '');
      const isAdmin = sessionId && adminSessions.has(sessionId);
      if (property.status === 'archived' && !isAdmin) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      res.json(property);
    } catch (error) {
      console.error("Error fetching property:", error);
      res.status(500).json({ message: "Failed to fetch property" });
    }
  });

  // Create new property (Admin only)
  app.post("/api/properties", requireAdminAuth, async (req, res) => {
    try {
      const result = insertPropertySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          error: "Invalid property data", 
          details: result.error.errors 
        });
      }

      const property = await storage.createProperty(result.data);
      res.status(201).json(property);
    } catch (error) {
      console.error("Error creating property:", error);
      res.status(500).json({ error: "Failed to create property" });
    }
  });

  // Create investment reservation
  app.post("/api/reservations", async (req, res) => {
    try {
      const validatedData = insertInvestmentReservationSchema.parse(req.body);
      
      // Add userId if user is authenticated
      let reservationData = validatedData;
      if (req.isAuthenticated() && req.user) {
        reservationData = {
          ...validatedData,
          userId: (req.user as any).id
        };
      }
      
      // Check if property exists
      const property = await storage.getProperty(reservationData.propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Check if there are available slots
      const units = typeof reservationData.units === 'string' ? parseFloat(reservationData.units) : reservationData.units;
      if (property.availableSlots < units) {
        return res.status(400).json({ message: "Not enough available slots" });
      }

      const reservation = await storage.createInvestmentReservation(reservationData);
      
      // Update property available slots
      await storage.updatePropertySlots(reservationData.propertyId, units);

      // Generate referral code for the user
      const referralCode = `REF${Date.now().toString().slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      
      // Send confirmation email
      try {
        const investmentAmount = units * property.minInvestment;
        const emailTemplate = investmentEmailTemplate({
          fullName: reservationData.fullName,
          propertyName: property.name,
          amount: investmentAmount,
          referralCode: referralCode
        });
        
        await sendEmail({
          to: reservationData.email,
          subject: emailTemplate.subject,
          html: emailTemplate.html
        });
        
        console.log(`Investment confirmation email sent to ${reservationData.email}`);
      } catch (emailError) {
        console.error("Failed to send investment confirmation email:", emailError);
        // Don't fail the request if email fails
      }
      
      res.status(201).json(reservation);
    } catch (error) {
      console.error("Error creating reservation:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid data provided" });
      }
      res.status(500).json({ message: "Failed to create reservation" });
    }
  });

  // Get user's reservations
  app.get("/api/reservations", async (req, res) => {
    try {
      const { email } = req.query;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: "Email parameter is required" });
      }

      const reservations = await storage.getReservationsByEmail(email);
      res.json(reservations);
    } catch (error) {
      console.error("Error fetching reservations:", error);
      res.status(500).json({ message: "Failed to fetch reservations" });
    }
  });

  // Get all reservations (Admin only)
  app.get("/api/reservations/all", async (req, res) => {
    try {
      const reservations = await storage.getAllReservations();
      res.json(reservations);
    } catch (error) {
      console.error("Error fetching all reservations:", error);
      res.status(500).json({ message: "Failed to fetch reservations" });
    }
  });

  // Mark reservation as paid (Admin only)
  app.post("/api/reservations/:id/mark-paid", requireAdminAuth, async (req, res) => {
    try {
      const reservationId = parseInt(req.params.id);
      
      // Get reservation details
      const reservations = await storage.getAllReservations();
      const reservation = reservations.find(r => r.id === reservationId);
      
      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      // Get property details
      const property = await storage.getProperty(reservation.propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Send payment confirmation email
      const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
      const investmentAmount = units * property.minInvestment;
      await sendEmail({
        to: reservation.email,
        subject: "Payment Confirmed - Brikvest Investment",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Payment Confirmed</h1>
            </div>
            <div style="background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px;">
              <h2 style="color: #374151; margin-bottom: 20px;">Thank you for your investment!</h2>
              <p style="color: #6b7280; margin-bottom: 20px;">
                We've received and confirmed your payment for your investment in <strong>${property.name}</strong>.
              </p>
              <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
                <h3 style="color: #374151; margin: 0 0 15px 0;">Investment Details:</h3>
                <p style="color: #6b7280; margin: 5px 0;"><strong>Property:</strong> ${property.name}</p>
                <p style="color: #6b7280; margin: 5px 0;"><strong>Units:</strong> ${reservation.units}</p>
                <p style="color: #6b7280; margin: 5px 0;"><strong>Amount:</strong> ₦${investmentAmount.toLocaleString()}</p>
                <p style="color: #6b7280; margin: 5px 0;"><strong>Referral Code:</strong> ${reservation.referralCode || 'None'}</p>
              </div>
              <p style="color: #6b7280; margin-bottom: 20px;">
                Your investment is now active and you'll receive updates on the property development progress.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.brikvest.net" style="background-color: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  View Dashboard
                </a>
              </div>
              <p style="color: #9ca3af; font-size: 14px; margin-top: 30px;">
                Thank you for choosing Brikvest for your real estate investment needs.
              </p>
            </div>
          </div>
        `
      });

      res.json({ message: "Payment confirmation sent successfully" });
    } catch (error) {
      console.error("Error marking reservation as paid:", error);
      res.status(500).json({ message: "Failed to send payment confirmation" });
    }
  });

  // Seed initial properties if none exist
  app.post("/api/seed-properties", async (req, res) => {
    try {
      const existingProperties = await storage.getProperties();
      
      if (existingProperties.length === 0) {
        const sampleProperties = [
          {
            name: "Victoria Island Office Complex",
            location: "Victoria Island, Lagos",
            description: "Premium 24-unit commercial office complex in Lagos's financial district with modern amenities and high occupancy rates.",
            totalValue: 1200000000,
            minInvestment: 500000,
            projectedReturn: "12.50",
            availableSlots: 127,
            totalSlots: 240,
            fundingProgress: 53,
            imageUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=400",
            status: "active"
          },
          {
            name: "Luxury Residences Lekki",
            location: "Lekki Phase 1, Lagos",
            description: "Grade A residential complex in Lekki's rapidly growing area with long-term corporate tenants and expatriate housing.",
            totalValue: 1600000000,
            minInvestment: 750000,
            projectedReturn: "15.20",
            availableSlots: 89,
            totalSlots: 213,
            fundingProgress: 42,
            imageUrl: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=400",
            status: "active"
          },
          {
            name: "Ikeja City Mall",
            location: "Ikeja, Lagos",
            description: "Modern retail plaza with anchor tenants and prime location in Lagos's commercial hub.",
            totalValue: 900000000,
            minInvestment: 400000,
            projectedReturn: "11.80",
            availableSlots: 156,
            totalSlots: 180,
            fundingProgress: 87,
            imageUrl: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=400",
            status: "active"
          },
          {
            name: "Logistics Hub Ogun",
            location: "Ogun State",
            description: "Strategic industrial facility serving major e-commerce and distribution networks in Southwest Nigeria.",
            totalValue: 2050000000,
            minInvestment: 1000000,
            projectedReturn: "10.50",
            availableSlots: 78,
            totalSlots: 205,
            fundingProgress: 38,
            imageUrl: "https://images.unsplash.com/photo-1587293852726-70cdb56c2866?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=400",
            status: "active"
          },
          {
            name: "Abuja Mixed-Use Tower",
            location: "Central Business District, Abuja",
            description: "Mixed-use development combining retail, office, and residential spaces in Nigeria's capital city.",
            totalValue: 2800000000,
            minInvestment: 1250000,
            projectedReturn: "16.80",
            availableSlots: 45,
            totalSlots: 224,
            fundingProgress: 20,
            imageUrl: "https://images.unsplash.com/photo-1582407947304-fd86f028f716?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=400",
            status: "active"
          },
          {
            name: "Eko Atlantic Towers",
            location: "Eko Atlantic City, Lagos",
            description: "Premium waterfront property development with luxury amenities and strong rental potential in Lagos's new financial center.",
            totalValue: 4100000000,
            minInvestment: 2500000,
            projectedReturn: "18.50",
            availableSlots: 67,
            totalSlots: 164,
            fundingProgress: 59,
            imageUrl: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=400",
            status: "active"
          }
        ];

        for (const propertyData of sampleProperties) {
          await storage.createProperty(propertyData);
        }

        res.json({ message: "Sample properties created successfully" });
      } else {
        res.json({ message: "Properties already exist" });
      }
    } catch (error) {
      console.error("Error seeding properties:", error);
      res.status(500).json({ message: "Failed to seed properties" });
    }
  });

  // Update property (Admin only)
  app.put("/api/properties/:id", requireAdminAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const result = insertPropertySchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          error: "Invalid property data", 
          details: result.error.errors 
        });
      }

      const property = await storage.updateProperty(propertyId, result.data);
      res.json(property);
    } catch (error) {
      console.error("Error updating property:", error);
      res.status(500).json({ error: "Failed to update property" });
    }
  });

  // Delete property (Admin only)
  app.delete("/api/properties/:id", requireAdminAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      await storage.deleteProperty(propertyId);
      res.json({ message: "Property deleted successfully" });
    } catch (error) {
      console.error("Error deleting property:", error);
      res.status(500).json({ error: "Failed to delete property" });
    }
  });

  // File upload endpoint for partnership documents
  app.post("/api/upload/document", upload.single('document'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const result = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
        'brikvest/documents'
      );

      res.json({
        url: result.url,
        publicId: result.publicId,
        originalName: req.file.originalname
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  // File upload endpoint for property images
  app.post("/api/upload/image", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const result = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
        'brikvest/properties'
      );

      res.json({
        url: result.url,
        publicId: result.publicId,
        originalName: req.file.originalname
      });
    } catch (error) {
      console.error("Error uploading image:", error);
      res.status(500).json({ error: "Failed to upload image" });
    }
  });

  // File upload endpoint for property videos
  app.post("/api/upload/video", upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Check if it's actually a video file
      if (!req.file.mimetype.startsWith('video/')) {
        return res.status(400).json({ error: "Invalid file type. Please upload a video file." });
      }

      const result = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
        'brikvest/videos'
      );

      res.json({
        url: result.url,
        publicId: result.publicId,
        originalName: req.file.originalname
      });
    } catch (error) {
      console.error("Error uploading video:", error);
      res.status(500).json({ error: "Failed to upload video" });
    }
  });

  // Investment Group Routes
  
  // Create investment group
  app.post("/api/groups", async (req, res) => {
    try {
      const validatedData = insertInvestmentGroupSchema.parse(req.body);
      
      // Generate unique invite code
      const inviteCode = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      const groupData = {
        ...validatedData,
        inviteCode
      };
      
      const group = await storage.createInvestmentGroup(groupData);
      
      // Add creator as first member
      const membershipData = {
        groupId: group.id,
        memberEmail: group.creatorEmail,
        memberName: "Group Creator",
        memberPhone: "",
        contributionAmount: 0
      };
      
      await storage.createGroupMembership(membershipData);
      
      res.status(201).json(group);
    } catch (error) {
      console.error("Error creating investment group:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid data provided" });
      }
      res.status(500).json({ message: "Failed to create investment group" });
    }
  });

  // Get all investment groups
  app.get("/api/groups", async (req, res) => {
    try {
      const groups = await storage.getInvestmentGroups();
      res.json(groups);
    } catch (error) {
      console.error("Error fetching investment groups:", error);
      res.status(500).json({ message: "Failed to fetch investment groups" });
    }
  });

  // Get specific investment group
  app.get("/api/groups/:id", async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      const group = await storage.getInvestmentGroup(groupId);
      
      if (!group) {
        return res.status(404).json({ message: "Investment group not found" });
      }
      
      res.json(group);
    } catch (error) {
      console.error("Error fetching investment group:", error);
      res.status(500).json({ message: "Failed to fetch investment group" });
    }
  });

  // Get investment group by invite code
  app.get("/api/groups/invite/:code", async (req, res) => {
    try {
      const inviteCode = req.params.code;
      const group = await storage.getInvestmentGroupByInviteCode(inviteCode);
      
      if (!group) {
        return res.status(404).json({ message: "Invalid invite code" });
      }
      
      res.json(group);
    } catch (error) {
      console.error("Error fetching group by invite code:", error);
      res.status(500).json({ message: "Failed to fetch group" });
    }
  });

  // Join investment group
  app.post("/api/groups/:id/join", async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      const validatedData = insertGroupMembershipSchema.parse(req.body);
      
      const group = await storage.getInvestmentGroup(groupId);
      if (!group) {
        return res.status(404).json({ message: "Investment group not found" });
      }
      
      if (group.currentMembers >= group.maxMembers) {
        return res.status(400).json({ message: "Group is full" });
      }
      
      if (group.status !== 'open') {
        return res.status(400).json({ message: "Group is not accepting new members" });
      }
      
      const membershipData = {
        ...validatedData,
        groupId
      };
      
      const membership = await storage.createGroupMembership(membershipData);
      
      // Update group member count and current amount
      await storage.updateInvestmentGroup(groupId, {
        currentMembers: group.currentMembers + 1,
        currentAmount: group.currentAmount + validatedData.contributionAmount
      });
      
      res.status(201).json(membership);
    } catch (error) {
      console.error("Error joining investment group:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid data provided" });
      }
      res.status(500).json({ message: "Failed to join investment group" });
    }
  });

  // Get group memberships
  app.get("/api/groups/:id/members", async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      const memberships = await storage.getGroupMemberships(groupId);
      res.json(memberships);
    } catch (error) {
      console.error("Error fetching group memberships:", error);
      res.status(500).json({ message: "Failed to fetch group memberships" });
    }
  });

  // Get user's group memberships
  app.get("/api/memberships", async (req, res) => {
    try {
      const { email } = req.query;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: "Email parameter is required" });
      }

      const memberships = await storage.getMembershipsByEmail(email);
      res.json(memberships);
    } catch (error) {
      console.error("Error fetching user memberships:", error);
      res.status(500).json({ message: "Failed to fetch memberships" });
    }
  });

  // Currency conversion endpoints
  app.get("/api/exchange-rates", async (req, res) => {
    try {
      const rates = await getExchangeRates();
      res.json({ rates, currencies: CURRENCY_CONFIG });
    } catch (error) {
      console.error("Error fetching exchange rates:", error);
      res.status(500).json({ error: "Failed to fetch exchange rates" });
    }
  });

  app.post("/api/convert-currency", async (req, res) => {
    try {
      const { amount, fromCurrency, toCurrency } = req.body;
      
      if (!amount || !fromCurrency || !toCurrency) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const rates = await getExchangeRates();
      const convertedAmount = convertCurrency(amount, fromCurrency, toCurrency, rates);
      const formattedAmount = formatCurrency(convertedAmount, toCurrency);

      res.json({
        originalAmount: amount,
        convertedAmount,
        formattedAmount,
        fromCurrency,
        toCurrency,
        exchangeRate: rates[toCurrency]
      });
    } catch (error) {
      console.error("Error converting currency:", error);
      res.status(500).json({ error: "Failed to convert currency" });
    }
  });

  app.get("/api/user-currency", async (req, res) => {
    try {
      const userCurrency = detectUserCurrency(req);
      res.json({ currency: userCurrency });
    } catch (error) {
      console.error("Error detecting user currency:", error);
      res.status(500).json({ error: "Failed to detect user currency" });
    }
  });

  // Enhanced properties endpoint with currency conversion (for buyers - excludes archived)
  app.get("/api/properties-converted", async (req, res) => {
    try {
      const properties = await storage.getPublicProperties(); // Only show public properties to buyers
      const userCurrency = req.query.currency as string || detectUserCurrency(req);
      
      const rates = await getExchangeRates();
      
      const convertedProperties = properties.map(property => {
        // Get the property's stored currency (default to USD for old properties without currency field)
        const storedCurrency = property.currency || 'USD';
        
        // If user currency matches stored currency, no conversion needed
        if (userCurrency === storedCurrency) {
          return {
            ...property,
            userCurrency
          };
        }

        // Convert from stored currency to user currency
        return {
          ...property,
          totalValue: convertCurrency(property.totalValue, storedCurrency, userCurrency, rates),
          minInvestment: convertCurrency(property.minInvestment, storedCurrency, userCurrency, rates),
          userCurrency
        };
      });

      res.json(convertedProperties);
    } catch (error) {
      console.error("Error fetching converted properties:", error);
      res.status(500).json({ error: "Failed to fetch properties with currency conversion" });
    }
  });

  // Verification routes
  // Get all verification steps
  app.get("/api/verification-steps", async (req, res) => {
    try {
      const steps = await storage.getVerificationSteps();
      res.json(steps);
    } catch (error) {
      console.error("Error fetching verification steps:", error);
      res.status(500).json({ message: "Failed to fetch verification steps" });
    }
  });

  // Get verification checklist for a property
  app.get("/api/properties/:id/verification", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const checklist = await storage.getPropertyVerificationChecklist(propertyId);
      res.json(checklist);
    } catch (error) {
      console.error("Error fetching property verification checklist:", error);
      res.status(500).json({ message: "Failed to fetch verification checklist" });
    }
  });

  // Update verification checklist for a property (Admin only)
  app.post("/api/properties/:id/verification", requireAdminAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const { enabledSteps } = req.body; // Array of verification step IDs

      if (!Array.isArray(enabledSteps)) {
        return res.status(400).json({ message: "enabledSteps must be an array" });
      }

      await storage.updatePropertyVerificationChecklist(propertyId, enabledSteps);
      res.json({ message: "Verification checklist updated successfully" });
    } catch (error) {
      console.error("Error updating property verification checklist:", error);
      res.status(500).json({ message: "Failed to update verification checklist" });
    }
  });

  // Update verification step completion (Admin only)
  app.put("/api/properties/:propertyId/verification/:stepId", requireAdminAuth, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const stepId = parseInt(req.params.stepId);
      const { isCompleted, notes, proofPhotos } = req.body;

      const adminId = req.user.userId;
      const completionData = {
        propertyId,
        verificationStepId: stepId,
        isCompleted: isCompleted || false,
        completedAt: isCompleted ? new Date() : null,
        completedBy: isCompleted ? adminId : null,
        proofPhotos: proofPhotos || [],
        notes: notes || null
      };

      await storage.updateVerificationStepCompletion(completionData);
      res.json({ message: "Verification step updated successfully" });
    } catch (error) {
      console.error("Error updating verification step completion:", error);
      res.status(500).json({ message: "Failed to update verification step" });
    }
  });

  // Get upload URL for verification photos (Admin only)
  app.post("/api/verification/upload-url", requireAdminAuth, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ message: "Failed to get upload URL" });
    }
  });

  // Set verification photo ACL after upload (Admin only)
  app.post("/api/verification/set-photo-acl", requireAdminAuth, async (req: any, res) => {
    try {
      const { photoURL } = req.body;
      const adminId = req.user.userId.toString();

      if (!photoURL) {
        return res.status(400).json({ error: "photoURL is required" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(
        photoURL,
        {
          owner: adminId,
          visibility: "public", // Make verification photos public for transparency
        }
      );

      res.json({ objectPath });
    } catch (error) {
      console.error("Error setting photo ACL:", error);
      res.status(500).json({ error: "Failed to set photo ACL" });
    }
  });

  // Serve verification photos (public access)
  app.get("/verification-photos/:objectPath(*)", async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(`/objects/${req.params.objectPath}`);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      console.error("Error serving verification photo:", error);
      if (error?.name === 'ObjectNotFoundError') {
        return res.status(404).json({ error: "Photo not found" });
      }
      return res.status(500).json({ error: "Failed to serve photo" });
    }
  });

  // Market Insights - Debug what scraper sees (Admin only)
  app.get("/api/market-insights/debug", requireAdminAuth, async (req, res) => {
    try {
      const url = 'https://propertypro.ng/index/sale/all/abuja/guzape';
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const html = await response.text();
      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);

      const debug = {
        url,
        status: response.status,
        pageTitle: $('title').text(),
        bodyClasses: $('body').attr('class') || 'none',
        totalDivs: $('div').length,
        divsWithPropertyClass: $('div[class*="property"]').length,
        divsWithListingClass: $('div[class*="listing"]').length,
        totalArticles: $('article').length,
        totalLinks: $('a').length,
        hasNairaSymbol: html.includes('₦'),
        nairaOccurrences: (html.match(/₦/g) || []).length,
        sampleClasses: [] as string[],
        sampleText: [] as string[],
        scriptTags: $('script[src]').map((_, el) => $(el).attr('src')).get().slice(0, 10),
        dataAttributes: [] as string[],
        propertyElements: [] as any[]
      };

      // Get sample element classes
      $('div, article').slice(0, 20).each((i, el) => {
        const className = $(el).attr('class');
        if (className) debug.sampleClasses.push(className);
      });

      // Look for elements that might contain property data
      const potentialContainers = $('[id*="property"], [id*="listing"], [class*="card"], [class*="item"]');
      debug.sampleText = potentialContainers.slice(0, 5).map((_, el) => {
        return $(el).text().trim().substring(0, 200);
      }).get();

      // Check for data attributes
      $('[data-property], [data-listing], [data-id]').slice(0, 10).each((_, el) => {
        const attrs = Object.keys(el.attribs || {}).filter(a => a.startsWith('data-'));
        debug.dataAttributes.push(...attrs);
      });

      // Extract property elements with their structure
      $('div, article').each((i, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        const hasPrice = text.includes('₦');
        const hasLink = $el.find('a').length > 0;
        
        if (hasPrice && hasLink && text.length > 50 && text.length < 500) {
          debug.propertyElements.push({
            tag: el.name,
            class: $el.attr('class'),
            id: $el.attr('id'),
            text: text.substring(0, 300),
            linkHref: $el.find('a').first().attr('href'),
            imageCount: $el.find('img').length,
            imageSrc: $el.find('img').first().attr('src')
          });
        }
      });

      res.json(debug);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Market Insights - Scrape PropertyPro.ng data (Admin only)
  app.post("/api/market-insights/scrape", requireAdminAuth, async (req, res) => {
    try {
      const { location = 'abuja' } = req.body;
      
      console.log(`Starting scrape for ${location}...`);
      const { scrapePropertyProAbuja } = await import('./scraper');
      const scrapedData = await scrapePropertyProAbuja(location);
      
      if (scrapedData.length === 0) {
        return res.status(404).json({ 
          message: "No properties found or unable to scrape data",
          count: 0 
        });
      }
      
      // Save scraped data to database
      const savedInsights = await storage.createMarketInsights(scrapedData);
      
      res.json({ 
        message: `Successfully scraped ${savedInsights.length} properties`,
        count: savedInsights.length,
        location,
        data: savedInsights
      });
    } catch (error) {
      console.error("Error scraping market insights:", error);
      res.status(500).json({ 
        message: "Failed to scrape market insights",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get market insights (Admin only)
  app.get("/api/market-insights", requireAdminAuth, async (req, res) => {
    try {
      const location = req.query.location as string | undefined;
      const insights = await storage.getMarketInsights(location);
      
      res.json(insights);
    } catch (error) {
      console.error("Error fetching market insights:", error);
      res.status(500).json({ message: "Failed to fetch market insights" });
    }
  });

  // Clean up old insights (Admin only)
  app.delete("/api/market-insights/cleanup", requireAdminAuth, async (req, res) => {
    try {
      const daysOld = parseInt(req.query.days as string) || 30;
      await storage.deleteOldInsights(daysOld);
      
      res.json({ message: `Deleted insights older than ${daysOld} days` });
    } catch (error) {
      console.error("Error cleaning up market insights:", error);
      res.status(500).json({ message: "Failed to clean up insights" });
    }
  });

  // Get raw HTML content from PropertyPro.ng page
  app.get("/api/scrape/guzape/raw", async (req, res) => {
    try {
      const url = 'https://propertypro.ng/index/sale/all/abuja/guzape';
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: `HTTP ${response.status}`,
          message: response.statusText 
        });
      }
      
      const html = await response.text();
      
      res.json({
        url,
        status: response.status,
        contentLength: html.length,
        content: html
      });
    } catch (error: any) {
      res.status(500).json({
        error: error.message || 'Failed to fetch page',
      });
    }
  });

  // Scrape Guzape listings from PropertyPro.ng
  app.get("/api/scrape/guzape", async (req, res) => {
    try {
      const persist = req.query.persist === '1';
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      
      // Import scraper functions
      const { fetchGuzapePage, scrapeGuzapeListings } = await import('./scrape/guzape');
      
      // Fetch HTML from PropertyPro.ng
      const html = await fetchGuzapePage();
      
      // Scrape listings from HTML
      const listings = scrapeGuzapeListings(html, limit);
      
      let persisted = 0;
      if (persist && listings.length > 0) {
        // Save to database
        const saved = await storage.saveGuzapeListings(listings);
        persisted = saved.length;
      }
      
      // Success response
      res.status(200).json({
        sourceUrl: 'https://propertypro.ng/index/sale/all/abuja/guzape',
        count: listings.length,
        persisted,
        listings
      });
    } catch (error: any) {
      console.error('Error in Guzape scraper:', error);
      
      // Handle different error types
      if (error.message?.includes('timeout')) {
        return res.status(503).json({
          error: 'Request timeout while fetching PropertyPro.ng',
          hint: 'The external site took too long to respond. Try again later.'
        });
      }
      
      if (error.message?.includes('429') || error.message?.includes('503')) {
        return res.status(503).json({
          error: 'External site unavailable or rate limited',
          hint: 'PropertyPro.ng returned an error. Please try again in a few minutes.'
        });
      }
      
      // Generic error
      res.status(503).json({
        error: error.message || 'Failed to scrape Guzape listings',
        hint: 'Check server logs for details or try again later.'
      });
    }
  });

  // Serve guzape.html from public directory
  app.get("/guzape.html", (req, res) => {
    const filePath = path.resolve(process.cwd(), 'public', 'guzape.html');
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send('File not found. Run the scraper first.');
    }
  });

  // Scrape Guzape HTML and optionally persist to public/guzape.html
  app.get("/api/scrape/guzape-html", async (req, res) => {
    try {
      const persist = req.query.persist === '1';
      const { fetchGuzapeRawHtml, persistGuzapeHtml } = await import('./scrape/guzapeHtml');
      
      const html = await fetchGuzapeRawHtml();
      
      if (persist) {
        await persistGuzapeHtml(html);
      }
      
      res.type('text/html').status(200).send(html);
    } catch (err: any) {
      res.status(503).json({ 
        error: err?.message || 'scrape failed', 
        hint: 'network/selectors/robots' 
      });
    }
  });

  // Extract graph data from scraped Guzape HTML
  app.get("/api/scrape/guzape-graphs", async (req, res) => {
    try {
      const { getGraphDataFromFile } = await import('./scrape/guzapeGraphs');
      const graphData = await getGraphDataFromFile();
      res.json(graphData);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to extract graph data';
      
      // Distinguish between missing file (404) and parse errors (500)
      if (errorMessage.includes('not found')) {
        return res.status(404).json({ 
          error: errorMessage,
          hint: 'Run the scraper first: /api/scrape/guzape-html?persist=1' 
        });
      }
      
      // Parse or other errors
      res.status(500).json({ 
        error: errorMessage,
        hint: 'Check server logs for details. The HTML structure may have changed.' 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
