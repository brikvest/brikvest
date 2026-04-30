import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { setupAuth, hashPassword, comparePasswords } from "./auth";
import passport from "passport";
import { randomBytes } from "crypto";
import { upload, uploadToCloudinary, uploadVideoToCloudinary, uploadToObjectStorage } from "./cloudinary";
import { sendEmail } from "./emailService";
import {
  sendListingApprovedEmail,
  sendListingRejectedEmail,
  sendNewBidNotificationEmail,
  sendOutbidEmail,
  sendHighestBidderEmail,
  sendAuctionWonEmail,
  sendFixedPricePurchaseEmail,
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
  sendTransferCompleteToSellerEmail,
  sendPaymentExpiredEmail,
  sendNextBidderOfferedEmail,
  sendNewListingNotificationToCoInvestors,
} from "./resaleEmails";
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

// Middleware: requires authenticated user with approved account
function requireApprovedUser(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }
  const user = req.user as any;
  if (user.accountStatus !== 'approved') {
    return res.status(403).json({ message: "Your account is pending approval. You will receive an email once approved." });
  }
  next();
}

// Generate unique SPV name
// Pattern: BRK + CITY(3) + DISTRICT(3) + PROPERTYID(padded)
// Example: BRKABJGUZ00033 for Abuja, Guzape, property ID 33
async function generateSpvName(city: string, district: string, propertyId: number): Promise<string> {
  const cityCode = city.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '');
  const districtCode = district.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '');
  const propertyCode = propertyId.toString().padStart(5, '0');
  return `BRK${cityCode}${districtCode}${propertyCode}`;
}

const REFERRAL_REWARD_TIERS = [
  { count: 1, reward: 20 },
  { count: 2, reward: 50 },
];

function calculateReferralReward(referralCount: number): number {
  let reward = 0;
  for (const tier of REFERRAL_REWARD_TIERS) {
    if (referralCount >= tier.count) {
      reward = tier.reward;
    }
  }
  return reward;
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
      const refCode = req.body.referralCode as string | undefined;
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "User already exists with this email" });
      }

      // Validate referral code and find referrer
      let referrerUser: any = null;
      if (refCode) {
        referrerUser = await storage.getUserByReferralCode(refCode);
        if (!referrerUser) {
          console.log(`[REFERRAL] Invalid referral code used during registration: ${refCode}`);
        }
      }

      // Generate unique referral code for new user (retry on collision)
      let uniqueReferralCode = '';
      for (let i = 0; i < 5; i++) {
        const candidate = 'BRIK-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const existing = await storage.getUserByReferralCode(candidate);
        if (!existing) {
          uniqueReferralCode = candidate;
          break;
        }
      }
      if (!uniqueReferralCode) {
        uniqueReferralCode = 'BRIK-' + Date.now().toString(36).toUpperCase();
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        emailVerified: true,
        accountStatus: 'approved',
        referralCode: uniqueReferralCode,
        referredByUserId: referrerUser?.id || null,
      });

      // Link any orphaned reservations to this user
      try {
        const linkedCount = await storage.linkOrphanedReservationsToUser(user.id, user.email);
        if (linkedCount > 0) {
          console.log(`[AUTO-LINK] Linked ${linkedCount} orphaned reservation(s) to new user ${user.id} (${user.email})`);
        }
      } catch (linkError) {
        console.error(`[AUTO-LINK] Failed to link reservations for user ${user.id}:`, linkError);
      }

      // Process referral if valid referrer found
      if (referrerUser && referrerUser.id !== user.id) {
        try {
          await storage.createReferral({
            referrerUserId: referrerUser.id,
            referredUserId: user.id,
            status: 'completed',
          });
          
          const referralCount = await storage.getReferralCountByReferrerId(referrerUser.id);
          const rewardAmount = calculateReferralReward(referralCount);
          await storage.upsertReferralReward(referrerUser.id, referralCount, rewardAmount);
          
          console.log(`[AUDIT:REFERRAL] User ${user.email} referred by ${referrerUser.email} (code: ${refCode}). Referrer now has ${referralCount} referral(s), reward: $${rewardAmount}`);
          
          try {
            const { referralSuccessEmailTemplate } = await import('./emailTemplates');
            const emailData = referralSuccessEmailTemplate({
              referrerName: referrerUser.firstName || 'Investor',
              referredName: firstName || 'A new user',
              referralCount,
              rewardAmount,
            });
            await sendEmail({
              to: referrerUser.email,
              subject: emailData.subject,
              html: emailData.html,
            });
          } catch (emailErr) {
            console.error(`[AUDIT:EMAIL] Failed to send referral success email to ${referrerUser.email}:`, emailErr);
          }
        } catch (refErr) {
          console.error(`[REFERRAL] Error processing referral:`, refErr);
        }
      }

      // Send notification email to admin about new registration
      try {
        await sendEmail({
          to: 'info@brikvest.net',
          subject: `New Brikvest Member Signup - ${firstName} ${lastName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a365d;">New Member Signup</h2>
              <p>A new user has just registered and was auto-approved:</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Name</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${firstName} ${lastName}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Email</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${email}</td></tr>
                <tr><td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Phone</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${phone || 'Not provided'}</td></tr>
              </table>
              <p>You can view and manage all members from the admin dashboard.</p>
            </div>
          `
        });
        console.log(`[AUDIT:REGISTRATION] New user registered and auto-approved: ${email} (${firstName} ${lastName})`);
      } catch (emailErr) {
        console.error(`[AUDIT:EMAIL] Failed to send admin notification for new registration ${email}:`, emailErr);
      }

      // Auto-login the new user since accounts are auto-approved
      const { password: _, ...userWithoutPassword } = user;
      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error("Auto-login after registration failed:", loginErr);
          return res.status(201).json({
            ...userWithoutPassword,
            message: "Your account has been created. Please log in to continue."
          });
        }
        return res.status(201).json({
          ...userWithoutPassword,
          message: "Welcome to Brikvest!"
        });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post('/api/login', passport.authenticate('local'), async (req, res) => {
    const user = req.user as any;
    
    // Link any orphaned reservations to this user on login
    try {
      const linkedCount = await storage.linkOrphanedReservationsToUser(user.id, user.email);
      if (linkedCount > 0) {
        console.log(`[AUTO-LINK] Linked ${linkedCount} orphaned reservation(s) to user ${user.id} (${user.email}) on login`);
      }
    } catch (linkError) {
      console.error(`[AUTO-LINK] Failed to link reservations for user ${user.id}:`, linkError);
      // Don't fail login if linking fails
    }
    
    const { password: _, ...userWithoutPassword } = user;
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
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/heic', 'image/heif'];
      const allowedDocumentTypes = [...allowedImageTypes, 'application/pdf']; // ID documents can be PDF or image
      const maxFileSize = 10 * 1024 * 1024; // 10MB
      
      // Upload ID document if provided
      let idDocumentUrl = existingUser?.kycIdDocumentUrl || null;
      if (files.idDocument && files.idDocument.length > 0) {
        const idDocumentFile = files.idDocument[0];
        
        if (!allowedDocumentTypes.includes(idDocumentFile.mimetype)) {
          return res.status(400).json({ 
            error: "Invalid file type for ID document. Only JPEG, PNG, WEBP, HEIC, and PDF files are allowed." 
          });
        }

        if (idDocumentFile.size > maxFileSize) {
          return res.status(400).json({ 
            error: "ID document file size exceeds 10MB limit." 
          });
        }

        // Route PDFs to Object Storage, images to Cloudinary
        const isPdf = idDocumentFile.mimetype === 'application/pdf';
        if (isPdf) {
          const idDocumentResult = await uploadToObjectStorage(
            idDocumentFile.buffer,
            idDocumentFile.originalname,
            idDocumentFile.mimetype,
            'kyc/documents'
          );
          idDocumentUrl = idDocumentResult.url;
        } else {
          const idDocumentResult = await uploadToCloudinary(
            idDocumentFile.buffer,
            idDocumentFile.originalname,
            'brikvest/kyc/documents'
          );
          idDocumentUrl = idDocumentResult.url;
        }
      }

      // Upload signature if provided (images only)
      let signatureUrl = existingUser?.kycSignatureUrl || null;
      if (files.signature && files.signature.length > 0) {
        const signatureFile = files.signature[0];
        
        if (!allowedImageTypes.includes(signatureFile.mimetype)) {
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

      // Upload selfie if provided (images only)
      let selfieUrl = existingUser?.kycSelfieUrl || null;
      if (files.selfie && files.selfie.length > 0) {
        const selfieFile = files.selfie[0];
        
        if (!allowedImageTypes.includes(selfieFile.mimetype)) {
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

      // Auto-extend active reservations by 24 hours (one-time extension)
      const extendedCount = await storage.extendReservationsOnKycSubmission(userId);

      res.json({ 
        message: "KYC submitted successfully",
        status: "submitted",
        reservationsExtended: extendedCount
      });
    } catch (error) {
      console.error("Error submitting KYC:", error);
      res.status(500).json({ error: "Failed to submit KYC verification" });
    }
  });

  // User payment proof submission endpoint
  app.post('/api/user/payment-submission', requireAuth, upload.single('paymentProof'), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { reservationId } = req.body;
      const file = req.file;

      if (!reservationId) {
        return res.status(400).json({ error: "Reservation ID is required" });
      }

      if (!file) {
        return res.status(400).json({ error: "Payment proof document is required" });
      }

      // Validate file type (image or PDF)
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ 
          error: "Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed." 
        });
      }

      const maxFileSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxFileSize) {
        return res.status(400).json({ error: "File size exceeds 10MB limit." });
      }

      // Get reservation and verify ownership
      const reservation = await storage.getReservation(parseInt(reservationId));
      if (!reservation) {
        return res.status(404).json({ error: "Reservation not found" });
      }

      if (reservation.userId !== userId) {
        return res.status(403).json({ error: "You can only submit payment for your own reservations" });
      }

      if (reservation.status !== 'reserved') {
        return res.status(400).json({ error: "This reservation is not awaiting payment" });
      }

      // Check if reservation has expired
      if (reservation.expiresAt && new Date(reservation.expiresAt) < new Date()) {
        return res.status(400).json({ 
          error: "This reservation has expired. Please create a new reservation to continue." 
        });
      }

      // Verify KYC is approved
      const user = await storage.getUser(userId);
      if (!user || user.kycStatus !== 'approved') {
        return res.status(403).json({ 
          error: "KYC verification must be approved before submitting payment proof" 
        });
      }

      // Check for existing pending submission
      const existingSubmissions = await storage.getPaymentSubmissionsByReservationId(parseInt(reservationId));
      const hasPending = existingSubmissions.some(s => s.status === 'pending_admin_review');
      if (hasPending) {
        return res.status(400).json({ error: "A payment proof is already pending review for this reservation" });
      }

      // Upload file (PDF to Object Storage, images to Cloudinary)
      let proofUrl: string;
      if (file.mimetype === 'application/pdf') {
        proofUrl = await uploadToObjectStorage(
          file.buffer,
          file.originalname,
          file.mimetype,
          'payment-proofs'
        );
      } else {
        const result = await uploadToCloudinary(
          file.buffer,
          file.originalname,
          'brikvest/payment-proofs'
        );
        proofUrl = result.url;
      }

      // Create payment submission
      const submission = await storage.createPaymentSubmission({
        reservationId: parseInt(reservationId),
        userId,
        proofUrl,
        proofType: file.mimetype === 'application/pdf' ? 'pdf' : 'image',
        amount: typeof reservation.amount === 'string' ? reservation.amount : String(reservation.amount || 0),
        currency: reservation.currency || 'NGN',
        paymentMethod: req.body.paymentMethod || 'bank_transfer',
        bankReference: req.body.bankReference || null,
        status: 'pending_admin_review'
      });

      res.json({ 
        message: "Payment proof submitted successfully. Please wait for admin review.",
        submission
      });
    } catch (error) {
      console.error("Error submitting payment proof:", error);
      res.status(500).json({ error: "Failed to submit payment proof" });
    }
  });

  // Get user's payment submissions
  app.get('/api/user/payment-submissions', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const submissions = await storage.getPaymentSubmissionsByUserId(userId);
      res.json(submissions);
    } catch (error) {
      console.error("Error fetching payment submissions:", error);
      res.status(500).json({ error: "Failed to fetch payment submissions" });
    }
  });

  // Get payment submissions for a specific reservation
  app.get('/api/user/reservations/:reservationId/payment-submissions', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const reservationId = parseInt(req.params.reservationId);
      
      // Verify ownership
      const reservation = await storage.getReservation(reservationId);
      if (!reservation || reservation.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const submissions = await storage.getPaymentSubmissionsByReservationId(reservationId);
      res.json(submissions);
    } catch (error) {
      console.error("Error fetching payment submissions:", error);
      res.status(500).json({ error: "Failed to fetch payment submissions" });
    }
  });

  // Referral API routes
  app.get('/api/user/referral', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const referralCount = await storage.getReferralCountByReferrerId(userId);
      const reward = await storage.getReferralRewardByUserId(userId);
      const referralsList = await storage.getReferralsByReferrerId(userId);

      const referralsWithDetails = await Promise.all(
        referralsList.map(async (ref) => {
          const referred = await storage.getUser(ref.referredUserId);
          return {
            id: ref.id,
            status: ref.status,
            createdAt: ref.createdAt,
            referredEmail: referred ? referred.email.replace(/(.{2}).*(@.*)/, '$1***$2') : 'Unknown',
            referredName: referred ? `${referred.firstName || ''} ${(referred.lastName || '').charAt(0)}.`.trim() : 'Unknown',
          };
        })
      );

      res.json({
        referralCode: user.referralCode,
        referralCount,
        rewardAmount: reward ? Number(reward.rewardAmount) : 0,
        payoutStatus: reward?.payoutStatus || 'pending',
        tiers: REFERRAL_REWARD_TIERS,
        referrals: referralsWithDetails,
      });
    } catch (error) {
      console.error("Error fetching referral data:", error);
      res.status(500).json({ error: "Failed to fetch referral data" });
    }
  });

  app.get('/api/validate-referral/:code', async (req, res) => {
    try {
      const { code } = req.params;
      const referrer = await storage.getUserByReferralCode(code);
      if (referrer) {
        res.json({ valid: true, referrerName: referrer.firstName || 'A Brikvest member' });
      } else {
        res.json({ valid: false });
      }
    } catch (error) {
      res.status(500).json({ valid: false });
    }
  });

  app.get('/api/admin/referral-rewards', requireAdminAuth, async (req, res) => {
    try {
      const rewards = await storage.getAllReferralRewards();
      const rewardsWithDetails = await Promise.all(
        rewards.map(async (r) => {
          const user = await storage.getUser(r.userId);
          return {
            ...r,
            userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
            userEmail: user?.email || 'Unknown',
          };
        })
      );
      res.json(rewardsWithDetails);
    } catch (error) {
      console.error("Error fetching referral rewards:", error);
      res.status(500).json({ error: "Failed to fetch referral rewards" });
    }
  });

  app.patch('/api/admin/referral-rewards/:id/payout', requireAdminAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!['pending', 'approved', 'paid'].includes(status)) {
        return res.status(400).json({ error: 'Invalid payout status' });
      }
      const reward = await storage.updateReferralRewardPayoutStatus(Number(id), status);
      res.json(reward);
    } catch (error) {
      console.error("Error updating payout status:", error);
      res.status(500).json({ error: "Failed to update payout status" });
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
      const { status, rejectionReason } = req.body;
      const adminUser = (req as any).user;

      console.log(`[AUDIT:KYC] Status update initiated: userId=${userId}, newStatus=${status}, admin=${adminUser.username}`);

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'" });
      }

      // Get user info before updating status
      const user = await storage.getUser(userId);
      if (!user) {
        console.log(`[AUDIT:KYC] Status update FAILED: userId=${userId} not found`);
        return res.status(404).json({ error: "User not found" });
      }

      const previousStatus = user.kycStatus;
      
      // Update KYC status with rejection reason if rejected
      await storage.updateUserKycStatus(userId, status, rejectionReason);
      
      if (status === 'approved') {
        console.log(`[AUDIT:KYC] APPROVED: userId=${userId}, email=${user.email}, fullName="${user.kycFullName}", previousStatus=${previousStatus}, approvedBy=${adminUser.username}`);
      } else {
        console.log(`[AUDIT:KYC] REJECTED: userId=${userId}, email=${user.email}, fullName="${user.kycFullName}", previousStatus=${previousStatus}, reason="${rejectionReason || 'N/A'}", rejectedBy=${adminUser.username}`);
      }

      // Send appropriate email
      try {
        const fullName = user.kycFullName || user.email.split('@')[0];
        
        if (status === 'approved') {
          const emailContent = kycApprovedEmailTemplate({ fullName });
          await sendEmail({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
          console.log(`[AUDIT:EMAIL] KYC approval sent: to=${user.email}, userId=${userId}`);
        } else if (status === 'rejected') {
          const emailContent = kycRejectedEmailTemplate({ fullName });
          await sendEmail({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
          });
          console.log(`[AUDIT:EMAIL] KYC rejection sent: to=${user.email}, userId=${userId}`);
        }
      } catch (emailError) {
        console.error(`[AUDIT:EMAIL] FAILED to send KYC ${status} email to ${user.email}:`, emailError);
        // Don't fail the request if email fails
      }

      res.json({ message: `KYC status updated to ${status}` });
    } catch (error) {
      console.error("[AUDIT:KYC] Status update ERROR:", error);
      res.status(500).json({ error: "Failed to update KYC status" });
    }
  });

  // Admin Payment Submission routes
  app.get('/api/admin/payment-submissions', requireAdminAuth, async (req, res) => {
    try {
      const submissions = await storage.getAllPendingPaymentSubmissions();
      
      // Enrich submissions with reservation and user details
      const enrichedSubmissions = await Promise.all(
        submissions.map(async (submission) => {
          const reservation = await storage.getReservation(submission.reservationId);
          const property = reservation ? await storage.getProperty(reservation.propertyId) : null;
          const user = await storage.getUser(submission.userId);
          return {
            ...submission,
            reservation,
            property,
            user: user ? {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              kycFullName: user.kycFullName
            } : null
          };
        })
      );
      
      res.json(enrichedSubmissions);
    } catch (error) {
      console.error("Error fetching payment submissions:", error);
      res.status(500).json({ error: "Failed to fetch payment submissions" });
    }
  });

  app.put('/api/admin/payment-submissions/:id/approve', requireAdminAuth, async (req, res) => {
    try {
      const submissionId = parseInt(req.params.id);
      const adminUser = (req as any).user;
      
      console.log(`[AUDIT:PAYMENT] Approval initiated: submissionId=${submissionId}, admin=${adminUser.username} (id=${adminUser.userId})`);
      
      const submission = await storage.getPaymentSubmission(submissionId);
      if (!submission) {
        console.log(`[AUDIT:PAYMENT] Approval FAILED: submissionId=${submissionId} not found`);
        return res.status(404).json({ error: "Payment submission not found" });
      }

      if (submission.status !== 'pending_admin_review') {
        console.log(`[AUDIT:PAYMENT] Approval BLOCKED: submissionId=${submissionId} already processed (status=${submission.status})`);
        return res.status(400).json({ error: "This submission has already been processed" });
      }

      const reservation = await storage.getReservation(submission.reservationId);
      if (!reservation) {
        console.log(`[AUDIT:PAYMENT] Approval FAILED: reservationId=${submission.reservationId} not found`);
        return res.status(404).json({ error: "Associated reservation not found" });
      }

      // Extra safeguard: verify reservation is still in valid state
      if (reservation.status !== 'reserved') {
        console.log(`[AUDIT:PAYMENT] Approval BLOCKED: reservationId=${reservation.id} not in reserved state (status=${reservation.status})`);
        return res.status(400).json({ 
          error: `Reservation is in '${reservation.status}' state, cannot approve payment.` 
        });
      }

      const property = await storage.getProperty(reservation.propertyId);
      if (!property) {
        console.log(`[AUDIT:PAYMENT] Approval FAILED: propertyId=${reservation.propertyId} not found`);
        return res.status(404).json({ error: "Associated property not found" });
      }

      const user = await storage.getUser(submission.userId);
      if (!user) {
        console.log(`[AUDIT:PAYMENT] Approval FAILED: userId=${submission.userId} not found`);
        return res.status(404).json({ error: "Associated user not found" });
      }

      // Block approval if KYC is not approved (scenario: user paid outside system without KYC)
      if (user.kycStatus !== 'approved') {
        console.log(`[AUDIT:PAYMENT] Approval BLOCKED: userId=${user.id} KYC not approved (kycStatus=${user.kycStatus})`);
        return res.status(400).json({ 
          error: "KYC must be approved before we can validate and allocate units. Please approve user's KYC first." 
        });
      }

      const reservedUnits = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
      console.log(`[AUDIT:PAYMENT] Proceeding with approval: userId=${user.id}, email=${user.email}, propertyId=${property.id}, propertyName="${property.name}", units=${reservedUnits}, amount=${reservation.amount}, currency=${reservation.currency}`);

      // Atomically: update submission, update reservation to converted, update property unit counts
      await storage.updatePaymentSubmission(submissionId, {
        status: 'approved',
        reviewedAt: new Date(),
        reviewedByAdminId: adminUser.userId
      });

      await storage.updateReservation(reservation.id, {
        status: 'converted_to_investment'
      });

      // Move units from reserved to sold
      await storage.updatePropertyUnitCounts(reservation.propertyId, -reservedUnits, reservedUnits);
      
      console.log(`[AUDIT:PAYMENT] APPROVED: submissionId=${submissionId}, reservationId=${reservation.id}, userId=${user.id}, email=${user.email}, units=${reservedUnits}, amount=${reservation.amount}, approvedBy=${adminUser.username}`);

      // Generate ownership certificate
      let certNumber = null;
      try {
        certNumber = await storage.getNextCertificateNumber();
        const verificationToken = randomBytes(32).toString('hex');
        
        await storage.createOwnershipCertificate({
          reservationId: reservation.id,
          userId: user.id,
          propertyId: reservation.propertyId,
          certificateNumber: certNumber,
          verificationToken,
          ownerName: user.kycFullName || `${user.firstName} ${user.lastName}`,
          propertyName: property.name,
          units: reservation.units,
          amount: reservation.amount?.toString() || '0',
          currency: reservation.currency || 'NGN'
        });
        console.log(`[AUDIT:CERTIFICATE] Generated: certNumber=${certNumber}, reservationId=${reservation.id}, userId=${user.id}`);
      } catch (certError) {
        console.error(`[AUDIT:CERTIFICATE] FAILED to generate for reservationId=${reservation.id}:`, certError);
        // Don't fail the whole operation if certificate generation fails
      }

      // Send confirmation email
      try {
        const emailContent = investmentConfirmedEmailTemplate({
          fullName: user.kycFullName || `${user.firstName} ${user.lastName}`,
          propertyName: property.name,
          units: reservation.units,
          amount: reservation.amount?.toString() || '0',
          currency: reservation.currency || 'NGN'
        });
        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html
        });
        console.log(`[AUDIT:EMAIL] Payment confirmation sent: to=${user.email}, reservationId=${reservation.id}`);
      } catch (emailError) {
        console.error(`[AUDIT:EMAIL] FAILED to send payment confirmation to ${user.email}:`, emailError);
        // Investment is confirmed even if email fails - log for retry
      }

      res.json({ 
        message: "Payment approved and investment confirmed",
        reservationId: reservation.id,
        certificateNumber: certNumber
      });
    } catch (error) {
      console.error("[AUDIT:PAYMENT] Approval ERROR:", error);
      res.status(500).json({ error: "Failed to approve payment" });
    }
  });

  app.put('/api/admin/payment-submissions/:id/reject', requireAdminAuth, async (req, res) => {
    try {
      const submissionId = parseInt(req.params.id);
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: "Rejection reason is required" });
      }

      const submission = await storage.getPaymentSubmission(submissionId);
      if (!submission) {
        return res.status(404).json({ error: "Payment submission not found" });
      }

      if (submission.status !== 'pending_admin_review') {
        return res.status(400).json({ error: "This submission has already been processed" });
      }

      const user = await storage.getUser(submission.userId);
      const reservation = await storage.getReservation(submission.reservationId);
      const property = reservation ? await storage.getProperty(reservation.propertyId) : null;

      const adminUser = (req as any).user;
      console.log(`[AUDIT:PAYMENT] Rejection initiated: submissionId=${submissionId}, reason="${reason}", admin=${adminUser.username}`);

      // Update submission status
      await storage.updatePaymentSubmission(submissionId, {
        status: 'rejected',
        reviewedAt: new Date(),
        rejectionReason: reason,
        reviewedByAdminId: adminUser.userId
      });
      
      console.log(`[AUDIT:PAYMENT] REJECTED: submissionId=${submissionId}, userId=${submission.userId}, reservationId=${submission.reservationId}, reason="${reason}", rejectedBy=${adminUser.username}`);

      // Send rejection email
      if (user) {
        try {
          await sendEmail({
            to: user.email,
            subject: "Payment Proof Rejected - Brikvest",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #ef4444; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0; font-size: 24px;">Payment Proof Rejected</h1>
                </div>
                <div style="background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p style="color: #374151; margin-bottom: 20px;">Dear ${user.kycFullName || user.firstName || 'Investor'},</p>
                  <p style="color: #6b7280; margin-bottom: 20px;">
                    Unfortunately, your payment proof for <strong>${property?.name || 'your reservation'}</strong> has been rejected.
                  </p>
                  <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin-bottom: 20px;">
                    <p style="color: #991b1b; margin: 0;"><strong>Reason:</strong> ${reason}</p>
                  </div>
                  <p style="color: #6b7280; margin-bottom: 20px;">
                    Please review the feedback above and submit a new payment proof from your dashboard.
                  </p>
                  <div style="text-align: center; margin-top: 30px;">
                    <a href="https://www.brikvest.net/dashboard" style="background-color: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">
                      Go to Dashboard
                    </a>
                  </div>
                </div>
              </div>
            `
          });
          console.log(`[AUDIT:EMAIL] Payment rejection sent: to=${user.email}, submissionId=${submissionId}`);
        } catch (emailError) {
          console.error(`[AUDIT:EMAIL] FAILED to send payment rejection to ${user.email}:`, emailError);
        }
      }

      res.json({ message: "Payment submission rejected" });
    } catch (error) {
      console.error("[AUDIT:PAYMENT] Rejection ERROR:", error);
      res.status(500).json({ error: "Failed to reject payment" });
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

  // Get pending user registrations for admin approval
  app.get('/api/admin/pending-users', requireAdminAuth, async (req, res) => {
    try {
      const pendingUsers = await storage.getPendingUsers();
      const safeUsers = pendingUsers.map(({ password, ...u }) => u);
      res.json(safeUsers);
    } catch (error) {
      console.error("Error fetching pending users:", error);
      res.status(500).json({ error: "Failed to fetch pending users" });
    }
  });

  // Approve user account
  app.post('/api/admin/users/:id/approve', requireAdminAuth, async (req: any, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (user.accountStatus === 'approved') {
        return res.status(400).json({ error: "User is already approved" });
      }

      const updatedUser = await storage.updateUserAccountStatus(userId, 'approved');
      const adminUsername = req.user?.username || 'unknown';
      console.log(`[AUDIT:ACCOUNT] Admin ${adminUsername} APPROVED account for user ${userId} (${user.email})`);

      // Send approval email to user
      try {
        await sendEmail({
          to: user.email,
          subject: 'Welcome to Brikvest - Your Membership Has Been Approved!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%); padding: 32px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to Brikvest</h1>
              </div>
              <div style="padding: 32px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="font-size: 16px; color: #334155;">Dear ${user.firstName || 'Member'},</p>
                <p style="font-size: 16px; color: #334155;">Great news! Your membership application has been <strong style="color: #16a34a;">approved</strong>.</p>
                <p style="font-size: 16px; color: #334155;">You can now sign in to your account and explore our exclusive property investment opportunities.</p>
                <div style="text-align: center; margin: 24px 0;">
                  <a href="https://brikvest.replit.app/login" style="background: #1a365d; color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: bold;">Sign In Now</a>
                </div>
                <p style="font-size: 14px; color: #64748b; margin-top: 24px;">Welcome to the club. We look forward to helping you build wealth through real estate.</p>
                <p style="font-size: 14px; color: #64748b;">— The Brikvest Team</p>
              </div>
            </div>
          `
        });
        console.log(`[AUDIT:EMAIL] Approval email sent successfully to ${user.email}`);
      } catch (emailErr) {
        console.error(`[AUDIT:EMAIL] Failed to send approval email to ${user.email}:`, emailErr);
      }

      const { password: _, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      console.error("Error approving user:", error);
      res.status(500).json({ error: "Failed to approve user" });
    }
  });

  // Reject user account
  app.post('/api/admin/users/:id/reject', requireAdminAuth, async (req: any, res) => {
    try {
      const userId = parseInt(req.params.id);
      const { reason } = req.body;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const updatedUser = await storage.updateUserAccountStatus(userId, 'rejected');
      const adminUsername = req.user?.username || 'unknown';
      console.log(`[AUDIT:ACCOUNT] Admin ${adminUsername} REJECTED account for user ${userId} (${user.email}). Reason: ${reason || 'No reason provided'}`);

      // Send rejection email to user
      try {
        await sendEmail({
          to: user.email,
          subject: 'Brikvest Membership Application Update',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%); padding: 32px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Brikvest</h1>
              </div>
              <div style="padding: 32px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="font-size: 16px; color: #334155;">Dear ${user.firstName || 'Applicant'},</p>
                <p style="font-size: 16px; color: #334155;">Thank you for your interest in joining Brikvest. Unfortunately, your membership application was not approved at this time.</p>
                ${reason ? `<p style="font-size: 16px; color: #334155;"><strong>Reason:</strong> ${reason}</p>` : ''}
                <p style="font-size: 16px; color: #334155;">If you believe this was a mistake or would like more information, please contact us at <a href="mailto:info@brikvest.net">info@brikvest.net</a>.</p>
                <p style="font-size: 14px; color: #64748b; margin-top: 24px;">— The Brikvest Team</p>
              </div>
            </div>
          `
        });
        console.log(`[AUDIT:EMAIL] Rejection email sent successfully to ${user.email}`);
      } catch (emailErr) {
        console.error(`[AUDIT:EMAIL] Failed to send rejection email to ${user.email}:`, emailErr);
      }

      const { password: _, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      console.error("Error rejecting user:", error);
      res.status(500).json({ error: "Failed to reject user" });
    }
  });

  // Get user portfolio (admin view of user's dashboard)
  app.get('/api/admin/users/portfolio', requireAdminAuth, async (req, res) => {
    try {
      const email = req.query.email as string;
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get user's reservations with property details
      const reservations = await storage.getUserReservationsWithPropertyByEmail(email);
      
      // Get certificates for confirmed investments
      const certificates = await storage.getCertificatesByUserId(user.id);
      
      // Attach certificates to reservations
      const reservationsWithCertificates = reservations.map((r: any) => {
        const certificate = certificates.find((c: any) => c.reservationId === r.id);
        return { ...r, certificate };
      });

      // Calculate summary (same logic as user dashboard)
      const confirmedAndReceived = reservations.filter((r: any) => 
        r.status === 'converted_to_investment'
      );
      
      const totalPortfolioValue = confirmedAndReceived.reduce((sum: number, r: any) => {
        const amount = typeof r.amount === 'string' ? parseFloat(r.amount) : (r.amount || 0);
        return sum + amount;
      }, 0);

      const propertiesOwned = new Set(
        reservations
          .filter((r: any) => r.status === 'converted_to_investment')
          .map((r: any) => r.propertyId)
      ).size;

      const activeReservations = reservations.filter((r: any) => 
        r.status === 'reserved'
      ).length;

      const confirmedInvestments = reservations.filter((r: any) => 
        r.status === 'converted_to_investment'
      ).length;

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          kycFullName: user.kycFullName,
          kycStatus: user.kycStatus,
          createdAt: user.createdAt,
        },
        reservations: reservationsWithCertificates,
        summary: {
          totalPortfolioValue,
          propertiesOwned,
          activeReservations,
          confirmedInvestments,
        },
      });
    } catch (error) {
      console.error("Error fetching user portfolio:", error);
      res.status(500).json({ error: "Failed to fetch user portfolio" });
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

      // Always use property's currency, default to NGN (Nigerian Naira) - platform's primary currency
      const investmentCurrency = property.currency || 'NGN';
      
      // Create reservation with 24-hour expiration
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      const reservation = await storage.createInvestmentReservation({
        userId,
        propertyId,
        fullName: user.kycFullName || `${user.firstName} ${user.lastName}`,
        email: user.email,
        phone: user.phone || '',
        units: units.toString(),
        amount,
        currency: investmentCurrency,
        unitPriceSnapshot,
        status: 'reserved',
        paymentMethod: paymentMethod || null,
        paymentReference: paymentReference || null,
        paymentEvidenceUrl: paymentEvidenceUrl || null,
        createdByAdminId: (req.user as any).userId,
        notes: notes || null,
        expiresAt,
      });
      
      console.log(`[INVESTMENT] Created reservation ${reservation.id} with currency ${investmentCurrency} for property ${property.name}`);

      // Update property reserved units
      await storage.updatePropertyUnitCounts(propertyId, units, 0);

      // Send email to user
      try {
        const emailContent = investmentCreatedEmailTemplate({
          fullName: reservation.fullName,
          propertyName: property.name,
          units,
          amount,
          currency: investmentCurrency,
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
      const { paymentMethod, paymentEvidenceUrl, amount } = req.body;

      const reservation = await storage.getReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ error: "Reservation not found" });
      }

      // Check if reservation has a user account linked
      if (!reservation.userId) {
        return res.status(400).json({ 
          error: "Cannot mark payment received. User must be signed in and linked to this reservation." 
        });
      }

      // Check KYC status - must be verified before payment can be recorded
      const user = await storage.getUser(reservation.userId);
      if (!user) {
        return res.status(400).json({ 
          error: "Cannot mark payment received. User account not found." 
        });
      }
      if (user.kycStatus !== 'approved') {
        return res.status(400).json({ 
          error: "Cannot mark payment received. User KYC must be approved first." 
        });
      }

      // Generate unique payment reference: BRK-YYYYMMDD-XXXXX
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
      const generatedPaymentReference = `BRK-${dateStr}-${randomPart}`;

      // Update reservation status with generated payment reference (keeping reserved until admin approves payment)
      await storage.updateReservation(reservationId, {
        status: 'reserved',
        paymentMethod: paymentMethod || reservation.paymentMethod,
        paymentReference: generatedPaymentReference,
        paymentEvidenceUrl: paymentEvidenceUrl || reservation.paymentEvidenceUrl,
      });

      // Create payment record - ensure amount is a proper number for bigint column
      const paymentAmount = amount 
        ? (typeof amount === 'string' ? Math.round(parseFloat(amount)) : Math.round(amount))
        : (typeof reservation.amount === 'string' ? Math.round(parseFloat(reservation.amount)) : Math.round(reservation.amount));
      
      await storage.createInvestmentPayment({
        reservationId,
        amount: paymentAmount,
        currency: reservation.currency,
        paymentMethod: paymentMethod || reservation.paymentMethod || 'bank_transfer',
        paymentReference: generatedPaymentReference,
        paymentEvidenceUrl: paymentEvidenceUrl || reservation.paymentEvidenceUrl,
        recordedByAdminId: (req.user as any).userId,
        status: 'received',
      });

      // Get property for email
      const property = await storage.getProperty(reservation.propertyId);
      
      // Send email to user with generated payment reference
      if (property) {
        try {
          const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
          const emailContent = paymentReceivedEmailTemplate({
            fullName: reservation.fullName,
            propertyName: property.name,
            units,
            amount: paymentAmount,
            currency: reservation.currency,
            paymentReference: generatedPaymentReference,
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

      res.json({ 
        message: "Payment marked as received", 
        paymentReference: generatedPaymentReference 
      });
    } catch (error) {
      console.error("Error marking payment as received:", error);
      res.status(500).json({ error: "Failed to mark payment as received" });
    }
  });

  // Confirm investment (validates KYC and moves to converted_to_investment)
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
        if (user && user.kycStatus !== 'approved') {
          return res.status(400).json({ 
            error: "Cannot confirm investment. User KYC must be approved first." 
          });
        }
      }

      // Update reservation to converted_to_investment
      await storage.updateReservation(reservationId, {
        status: 'converted_to_investment'
      });

      // Move units from reserved to sold
      const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
      await storage.updatePropertyUnitCounts(reservation.propertyId, -units, units);

      // Get property for email and certificate
      const property = await storage.getProperty(reservation.propertyId);
      
      // Generate ownership certificate
      let certificate = null;
      if (property) {
        try {
          // Generate unique verification token
          const verificationToken = randomBytes(32).toString('hex');
          
          // Get next certificate number
          const certificateNumber = await storage.getNextCertificateNumber();
          
          // Create the certificate
          certificate = await storage.createOwnershipCertificate({
            reservationId,
            certificateNumber,
            verificationToken,
            ownerName: reservation.fullName,
            propertyName: property.name,
            propertyLocation: property.location,
            spvName: property.spvName || null,
            units: reservation.units.toString(),
            amount: reservation.amount.toString(),
            currency: reservation.currency,
            issuedByAdminId: (req.user as any).userId,
          });
          
          console.log(`[CERTIFICATE] Generated certificate ${certificateNumber} for reservation ${reservationId}`);
        } catch (certError) {
          console.error("Error generating certificate:", certError);
          // Don't fail the whole confirmation if certificate fails
        }
      }
      
      // Send email to user with certificate info
      if (property) {
        try {
          const emailContent = investmentConfirmedEmailTemplate({
            fullName: reservation.fullName,
            propertyName: property.name,
            units,
            amount: reservation.amount,
            currency: reservation.currency,
            certificateNumber: certificate?.certificateNumber,
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

      res.json({ 
        message: "Investment confirmed successfully",
        certificateNumber: certificate?.certificateNumber 
      });
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

  // Generate certificates for all confirmed investments without certificates
  app.post('/api/admin/investments/generate-missing-certificates', requireAdminAuth, async (req, res) => {
    try {
      // Get all confirmed reservations
      const allReservations = await storage.getAllReservations();
      const confirmedReservations = allReservations.filter(r => r.status === 'converted_to_investment');
      
      let generated = 0;
      let errors = 0;
      const results: Array<{ reservationId: number; certificateNumber?: string; error?: string }> = [];
      
      for (const reservation of confirmedReservations) {
        // Check if certificate already exists
        const existingCert = await storage.getCertificateByReservationId(reservation.id);
        if (existingCert) {
          continue; // Skip if already has certificate
        }
        
        const property = await storage.getProperty(reservation.propertyId);
        if (!property) {
          results.push({ reservationId: reservation.id, error: 'Property not found' });
          errors++;
          continue;
        }
        
        try {
          const verificationToken = randomBytes(32).toString('hex');
          const certificateNumber = await storage.getNextCertificateNumber();
          
          const certificate = await storage.createOwnershipCertificate({
            reservationId: reservation.id,
            certificateNumber,
            verificationToken,
            ownerName: reservation.fullName,
            propertyName: property.name,
            propertyLocation: property.location,
            units: reservation.units.toString(),
            amount: reservation.amount.toString(),
            currency: reservation.currency,
            issuedByAdminId: (req.user as any).userId,
          });
          
          console.log(`[CERTIFICATE] Generated missing certificate ${certificateNumber} for reservation ${reservation.id}`);
          results.push({ reservationId: reservation.id, certificateNumber: certificate.certificateNumber });
          generated++;
        } catch (certError) {
          console.error(`Error generating certificate for reservation ${reservation.id}:`, certError);
          results.push({ reservationId: reservation.id, error: String(certError) });
          errors++;
        }
      }
      
      res.json({
        message: `Generated ${generated} certificates, ${errors} errors`,
        generated,
        errors,
        results
      });
    } catch (error) {
      console.error("Error generating missing certificates:", error);
      res.status(500).json({ error: "Failed to generate certificates" });
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

      // Release units back to the property for any active status
      if (reservation.status === 'reserved' || reservation.status === 'converted_to_investment') {
        const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
        // For converted_to_investment, decrease soldUnits; for reserved, decrease reservedUnits
        if (reservation.status === 'converted_to_investment') {
          await storage.updatePropertyUnitCounts(reservation.propertyId, 0, -units);
        } else {
          await storage.updatePropertyUnitCounts(reservation.propertyId, -units, 0);
        }
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

  // Cleanup expired reservations (admin only)
  app.post("/api/admin/cleanup-expired-reservations", requireAdminAuth, async (req, res) => {
    try {
      const result = await storage.cleanupExpiredReservations();
      res.json({
        message: `Cleanup complete: ${result.cancelled} reservations cancelled, ${result.unitsReleased} units released`,
        ...result
      });
    } catch (error) {
      console.error("Error cleaning up expired reservations:", error);
      res.status(500).json({ message: "Failed to cleanup expired reservations" });
    }
  });

  // Get all properties (admin view - includes all properties)
  app.get("/api/admin/properties", requireAdminAuth, async (req: any, res) => {
    try {
      const properties = await storage.getProperties();
      res.json(properties);
    } catch (error) {
      console.error("Error fetching properties (admin):", error);
      res.status(500).json({ message: "Failed to fetch properties" });
    }
  });

  // Get all properties (requires approved membership)
  app.get("/api/properties", requireApprovedUser, async (req: any, res) => {
    try {
      // Investors only see admin-created properties or developer-owned projects
      // that are live/sold_out. Draft/pending developer projects are hidden.
      const properties = await storage.getPublicProperties();
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

  // Get property by ID (requires approved membership, excludes archived for non-admin)
  app.get("/api/properties/:id", requireApprovedUser, async (req: any, res) => {
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

      // Hide draft / pending-approval developer projects from non-owner non-admin
      // (only the owning developer or an admin can view unpublished developer projects).
      if (
        property.developerId &&
        property.projectStatus !== 'live' &&
        property.projectStatus !== 'sold_out' &&
        !isAdmin &&
        req.user?.id !== property.developerId
      ) {
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

      // Create property first to get ID
      const property = await storage.createProperty(result.data);
      
      // Auto-generate SPV name if city and district are provided
      if (result.data.city && result.data.district && !result.data.spvName) {
        const spvName = await generateSpvName(result.data.city, result.data.district, property.id);
        await storage.updateProperty(property.id, { spvName });
        property.spvName = spvName;
        console.log(`[SPV] Auto-generated SPV name: ${spvName} for property ${property.id}`);
      }
      
      res.status(201).json(property);
    } catch (error) {
      console.error("Error creating property:", error);
      res.status(500).json({ error: "Failed to create property" });
    }
  });

  // Create investment reservation
  app.post("/api/reservations", async (req, res) => {
    try {
      // Validate request data
      const result = insertInvestmentReservationSchema.safeParse(req.body);
      if (!result.success) {
        // Create user-friendly error message
        const errors = result.error.errors.map(err => {
          const field = err.path.join('.');
          switch (field) {
            case 'fullName':
              return 'Please enter your full name';
            case 'email':
              return 'Please enter a valid email address';
            case 'phone':
              return 'Please enter a valid phone number';
            case 'units':
              return 'Please enter a valid number of units';
            case 'amount':
              return 'Invalid investment amount';
            case 'propertyId':
              return 'Please select a property';
            case 'unitPriceSnapshot':
              return 'Invalid price information';
            default:
              return err.message;
          }
        });
        return res.status(400).json({ 
          message: errors[0] || "Please check your information and try again",
          errors: errors
        });
      }

      const validatedData = result.data;
      
      // Validate units - must be positive
      const requestedUnits = typeof validatedData.units === 'string' ? parseFloat(validatedData.units) : validatedData.units;
      if (!requestedUnits || requestedUnits <= 0 || isNaN(requestedUnits)) {
        return res.status(400).json({ 
          message: "Please enter a valid number of units (must be greater than 0)" 
        });
      }
      
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
        return res.status(400).json({ message: "The selected property is no longer available" });
      }

      // Check if there are available slots
      const units = typeof reservationData.units === 'string' ? parseFloat(reservationData.units) : reservationData.units;
      if (property.availableSlots < units) {
        return res.status(400).json({ 
          message: `Only ${property.availableSlots} unit${property.availableSlots !== 1 ? 's' : ''} available. Please select a smaller quantity.` 
        });
      }

      // Idempotency check: prevent duplicate reservations within 60 seconds
      const recentReservations = await storage.getReservationsByEmail(reservationData.email);
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      const duplicateReservation = recentReservations.find(r => 
        r.propertyId === reservationData.propertyId && 
        r.status === 'reserved' &&
        new Date(r.createdAt) > oneMinuteAgo
      );
      if (duplicateReservation) {
        console.log(`[RESERVATION] Duplicate reservation prevented for ${reservationData.email} on property ${reservationData.propertyId}`);
        return res.status(200).json(duplicateReservation); // Return existing reservation instead of error
      }

      // Enforce currency consistency - always use property's currency, default to NGN
      const investmentCurrency = property.currency || 'NGN';
      
      // Set 24-hour expiration for reservation
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      const sanitizedReservationData = {
        ...reservationData,
        currency: investmentCurrency, // Override any user-provided currency with property's currency
        expiresAt,
      };
      
      console.log(`[RESERVATION] Creating reservation with currency ${investmentCurrency} for property ${property.name} (expires ${expiresAt.toISOString()})`);

      const reservation = await storage.createInvestmentReservation(sanitizedReservationData);
      
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
      
      // Enrich reservations with certificate data
      const enrichedReservations = await Promise.all(
        reservations.map(async (reservation: any) => {
          const certificate = await storage.getCertificateByReservationId(reservation.id);
          return {
            ...reservation,
            certificateNumber: certificate?.certificateNumber || null,
            certificateId: certificate?.id || null,
          };
        })
      );
      
      res.json(enrichedReservations);
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
  app.post("/api/seed-properties", requireAdminAuth, async (req: any, res) => {
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

  // Upload valuation report PDF for a property (Admin only)
  app.post("/api/admin/properties/:id/valuation-report", requireAdminAuth, upload.single('valuationReport'), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      if (file.mimetype !== 'application/pdf') {
        return res.status(400).json({ error: "Only PDF files are allowed for valuation reports" });
      }
      
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      
      const result = await uploadToObjectStorage(
        file.buffer,
        file.originalname,
        file.mimetype,
        'valuation-reports'
      );
      
      const updated = await storage.updateProperty(propertyId, {
        ...property,
        valuationReportUrl: result.url,
        valuationReportName: file.originalname,
      });
      
      res.json({ message: "Valuation report uploaded successfully", property: updated });
    } catch (error) {
      console.error("Error uploading valuation report:", error);
      res.status(500).json({ error: "Failed to upload valuation report" });
    }
  });
  
  // Remove valuation report from a property (Admin only)
  app.delete("/api/admin/properties/:id/valuation-report", requireAdminAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      
      const updated = await storage.updateProperty(propertyId, {
        ...property,
        valuationReportUrl: null,
        valuationReportName: null,
      });
      
      res.json({ message: "Valuation report removed", property: updated });
    } catch (error) {
      console.error("Error removing valuation report:", error);
      res.status(500).json({ error: "Failed to remove valuation report" });
    }
  });
  
  // Get valuation report for a property (only investors who have bought units)
  app.get("/api/properties/:id/valuation-report", requireApprovedUser, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const userId = req.user.id;
      
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      
      if (!property.valuationReportUrl) {
        return res.status(404).json({ error: "No valuation report available for this property" });
      }
      
      const userReservations = await storage.getReservationsByUserId(userId);
      const hasInvestment = userReservations.some(
        r => r.propertyId === propertyId && r.status === 'converted_to_investment'
      );
      
      if (!hasInvestment) {
        return res.status(403).json({ error: "Only investors in this property can access the valuation report" });
      }
      
      res.json({
        url: property.valuationReportUrl,
        name: property.valuationReportName || 'Valuation Report.pdf',
      });
    } catch (error) {
      console.error("Error fetching valuation report:", error);
      res.status(500).json({ error: "Failed to fetch valuation report" });
    }
  });

  // Admin: Get all valuations for a property
  app.get("/api/admin/properties/:id/valuations", requireAdminAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const valuations = await storage.getPropertyValuations(propertyId);
      res.json(valuations);
    } catch (error) {
      console.error("Error fetching valuations:", error);
      res.status(500).json({ error: "Failed to fetch valuations" });
    }
  });

  // Admin: Create a valuation entry for a property
  app.post("/api/admin/properties/:id/valuations", requireAdminAuth, upload.single('valuationReport'), async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      const { valuationDate, currentValue, rawAssetValue, investorBasisValue, appreciationPercentage, notes } = req.body;

      if (!valuationDate || !currentValue) {
        return res.status(400).json({ error: "Valuation date and current value are required" });
      }

      let reportUrl = null;
      let reportName = null;

      if (req.file) {
        if (req.file.mimetype !== 'application/pdf') {
          return res.status(400).json({ error: "Only PDF files are allowed" });
        }
        const result = await uploadToObjectStorage(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'valuation-reports'
        );
        reportUrl = result.url;
        reportName = req.file.originalname;
      }

      const adminId = req.adminSession?.adminId || null;

      const valuation = await storage.createPropertyValuation({
        propertyId,
        valuationDate: new Date(valuationDate),
        currentValue,
        rawAssetValue: rawAssetValue || currentValue,
        investorBasisValue: investorBasisValue || currentValue,
        appreciationPercentage: appreciationPercentage || null,
        reportUrl,
        reportName,
        notes: notes || null,
        createdByAdminId: adminId,
      });

      if (reportUrl) {
        await storage.updateProperty(propertyId, {
          ...property,
          valuationReportUrl: reportUrl,
          valuationReportName: reportName,
        });
      }

      res.json(valuation);

      try {
        const reservations = await storage.getReservationsByProperty(propertyId);
        const confirmedInvestors = reservations.filter(r => r.status === 'converted_to_investment' && r.userId);
        const uniqueUserIds = Array.from(new Set(confirmedInvestors.map(r => r.userId!)));
        const formattedDate = new Date(valuationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        const { valuationUpdateEmailTemplate } = await import('./emailTemplates');

        for (const userId of uniqueUserIds) {
          try {
            const investor = await storage.getUser(userId);
            if (!investor) continue;
            const emailData = valuationUpdateEmailTemplate({
              firstName: investor.firstName || 'Investor',
              propertyName: property.name,
              valuationDate: formattedDate,
              hasReport: !!reportUrl,
            });
            await sendEmail({
              to: investor.email,
              subject: emailData.subject,
              html: emailData.html,
            });
          } catch (emailErr) {
            console.error(`[AUDIT:EMAIL] Failed to send valuation update email to userId ${userId}:`, emailErr);
          }
        }
        console.log(`[AUDIT:VALUATION] Notified ${uniqueUserIds.length} investor(s) about valuation update for property ${propertyId} (${property.name})`);
      } catch (notifyErr) {
        console.error(`[AUDIT:EMAIL] Failed to notify investors about valuation update:`, notifyErr);
      }
    } catch (error) {
      console.error("Error creating valuation:", error);
      res.status(500).json({ error: "Failed to create valuation" });
    }
  });

  // Admin: Delete a valuation entry
  app.delete("/api/admin/valuations/:id", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deletePropertyValuation(id);
      res.json({ message: "Valuation deleted" });
    } catch (error) {
      console.error("Error deleting valuation:", error);
      res.status(500).json({ error: "Failed to delete valuation" });
    }
  });

  app.post("/api/admin/valuations/:id/notify", requireAdminAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const valuation = await storage.getPropertyValuation(id);
      if (!valuation) {
        return res.status(404).json({ error: "Valuation not found" });
      }

      const property = await storage.getProperty(valuation.propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      const reservations = await storage.getReservationsByProperty(valuation.propertyId);
      const confirmedInvestors = reservations.filter(r => r.status === 'converted_to_investment' && r.userId);
      const uniqueUserIds = Array.from(new Set(confirmedInvestors.map(r => r.userId!)));

      if (uniqueUserIds.length === 0) {
        return res.json({ message: "No confirmed investors to notify", sent: 0 });
      }

      const formattedDate = new Date(valuation.valuationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const { valuationUpdateEmailTemplate } = await import('./emailTemplates');

      let sent = 0;
      for (const userId of uniqueUserIds) {
        try {
          const investor = await storage.getUser(userId);
          if (!investor) continue;
          const emailData = valuationUpdateEmailTemplate({
            firstName: investor.firstName || 'Investor',
            propertyName: property.name,
            valuationDate: formattedDate,
            hasReport: !!valuation.reportUrl,
          });
          await sendEmail({
            to: investor.email,
            subject: emailData.subject,
            html: emailData.html,
          });
          sent++;
        } catch (emailErr) {
          console.error(`[AUDIT:EMAIL] Failed to send valuation notification to userId ${userId}:`, emailErr);
        }
      }

      console.log(`[AUDIT:VALUATION] Resent notifications to ${sent}/${uniqueUserIds.length} investor(s) for valuation ${id} on property ${property.name}`);
      res.json({ message: `Notifications sent to ${sent} investor(s)`, sent });
    } catch (error) {
      console.error("Error resending valuation notifications:", error);
      res.status(500).json({ error: "Failed to send notifications" });
    }
  });

  app.get("/api/properties/:id/valuations-public", async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      const valuations = await storage.getPropertyValuations(propertyId);
      const sanitized = valuations.map(v => ({
        id: v.id,
        propertyId: v.propertyId,
        valuationDate: v.valuationDate,
        currentValue: v.currentValue,
        rawAssetValue: v.rawAssetValue,
        appreciationPercentage: v.appreciationPercentage,
        notes: v.notes,
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching public valuations:", error);
      res.status(500).json({ error: "Failed to fetch valuations" });
    }
  });

  app.get("/api/properties/:id/valuation-report-public", async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      if (!property.valuationReportUrl) {
        return res.status(404).json({ error: "No valuation report available for this property" });
      }
      res.json({
        url: property.valuationReportUrl,
        name: property.valuationReportName || 'Valuation Report.pdf',
      });
    } catch (error) {
      console.error("Error fetching public valuation report:", error);
      res.status(500).json({ error: "Failed to fetch valuation report" });
    }
  });

  // User: Get valuation history for a property (only if investor has confirmed investment)
  app.get("/api/properties/:id/valuations", requireApprovedUser, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const userId = req.user.id;

      const userReservations = await storage.getReservationsByUserId(userId);
      const hasInvestment = userReservations.some(
        r => r.propertyId === propertyId && r.status === 'converted_to_investment'
      );

      if (!hasInvestment) {
        return res.status(403).json({ error: "Only investors in this property can access valuation history" });
      }

      const valuations = await storage.getPropertyValuations(propertyId);
      res.json(valuations);
    } catch (error) {
      console.error("Error fetching valuations:", error);
      res.status(500).json({ error: "Failed to fetch valuations" });
    }
  });

  // Delete property (Admin only)
  app.delete("/api/properties/:id", requireAdminAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      
      // Get the property first
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      
      // Get all reservations for this property
      const allReservations = await storage.getAllReservations();
      const propertyReservations = allReservations.filter(r => r.propertyId === propertyId);
      
      // Check if any reservations are converted to investments
      const paidReservations = propertyReservations.filter(r => 
        r.status === 'converted_to_investment'
      );
      
      if (paidReservations.length > 0) {
        return res.status(400).json({ 
          error: `Cannot delete property. There are ${paidReservations.length} active investment(s). Cancel those investments first.` 
        });
      }
      
      // Cancel all reserved reservations and notify users
      const pendingReservations = propertyReservations.filter(r => r.status === 'reserved');
      
      for (const reservation of pendingReservations) {
        // Cancel the reservation
        await storage.updateReservation(reservation.id, { status: 'cancelled' });
        
        // Send notification email
        try {
          await sendEmail({
            to: reservation.email,
            subject: "Property Removed - Brikvest",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #ef4444; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0; font-size: 24px;">Property Removed</h1>
                </div>
                <div style="background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px;">
                  <p style="color: #374151; margin-bottom: 20px;">Dear ${reservation.fullName},</p>
                  <p style="color: #6b7280; margin-bottom: 20px;">
                    We regret to inform you that the property <strong>${property.name}</strong> has been removed from our platform.
                  </p>
                  <p style="color: #6b7280; margin-bottom: 20px;">
                    Your reservation for this property has been automatically cancelled. No payment was received, so no refund is necessary.
                  </p>
                  <p style="color: #6b7280; margin-bottom: 20px;">
                    We apologize for any inconvenience this may cause. Please feel free to explore other investment opportunities on our platform.
                  </p>
                  <div style="text-align: center; margin-top: 30px;">
                    <a href="https://www.brikvest.net" style="background-color: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">
                      Browse Properties
                    </a>
                  </div>
                  <p style="color: #9ca3af; font-size: 14px; margin-top: 30px;">
                    If you have any questions, please contact our support team.
                  </p>
                </div>
              </div>
            `,
          });
          console.log(`[DELETE PROPERTY] Notified ${reservation.email} about cancelled reservation for property ${propertyId}`);
        } catch (emailError) {
          console.error(`Error sending cancellation email to ${reservation.email}:`, emailError);
        }
      }
      
      // Now delete the property
      await storage.deleteProperty(propertyId);
      
      res.json({ 
        message: "Property deleted successfully",
        cancelledReservations: pendingReservations.length,
        notifiedUsers: pendingReservations.map(r => r.email)
      });
    } catch (error) {
      console.error("Error deleting property:", error);
      res.status(500).json({ error: "Failed to delete property" });
    }
  });

  // File upload endpoint for documents (PDFs go to Object Storage, images to Cloudinary)
  app.post("/api/upload/document", upload.single('document'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Route PDFs to Object Storage, images to Cloudinary
      const isPdf = req.file.mimetype === 'application/pdf';
      
      if (isPdf) {
        const result = await uploadToObjectStorage(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'documents'
        );

        res.json({
          url: result.url,
          path: result.path,
          originalName: req.file.originalname,
          storageType: 'object_storage'
        });
      } else {
        const result = await uploadToCloudinary(
          req.file.buffer,
          req.file.originalname,
          'brikvest/documents'
        );

        res.json({
          url: result.url,
          publicId: result.publicId,
          originalName: req.file.originalname,
          storageType: 'cloudinary'
        });
      }
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

      const result = await uploadVideoToCloudinary(
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

  // Serve documents from Object Storage (PDFs)
  // Use wildcard to capture full path including slashes
  app.get("/api/documents/*", async (req, res) => {
    try {
      // Extract the full path after /api/documents/
      const fullPath = (req.params as any)[0] as string; // e.g., "kyc/documents/filename.pdf" or "documents/filename.pdf"
      
      const privateDir = process.env.PRIVATE_OBJECT_DIR || '';
      
      if (!privateDir) {
        return res.status(500).json({ error: "Object storage not configured" });
      }

      // Parse bucket name from PRIVATE_OBJECT_DIR
      const pathParts = privateDir.split('/').filter(p => p);
      const bucketName = pathParts[0];
      
      // Construct the full path
      const objectPath = `.private/${fullPath}`;
      
      // Extract filename for Content-Disposition header
      const filename = fullPath.split('/').pop() || 'document.pdf';
      
      // Get the file from Object Storage
      const objectStorageClient = (await import('./objectStorage')).objectStorageClient;
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectPath);
      
      // Check if file exists
      const [exists] = await file.exists();
      if (!exists) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      // Get file metadata
      const [metadata] = await file.getMetadata();
      
      // Set headers
      res.set({
        'Content-Type': metadata.contentType || 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600'
      });
      
      // Stream the file to the response
      const stream = file.createReadStream();
      
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming document" });
        }
      });
      
      stream.pipe(res);
    } catch (error) {
      console.error("Error serving document:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to serve document" });
      }
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

  // Enhanced properties endpoint with currency conversion (public access)
  app.get("/api/properties-converted", async (req: any, res) => {
    try {
      const properties = await storage.getPublicProperties(); // Only show public properties to buyers
      const userCurrency = req.query.currency as string || detectUserCurrency(req);
      
      const rates = await getExchangeRates();
      
      const convertedProperties = properties.map(property => {
        // Get the property's stored currency (default to USD for old properties without currency field)
        const storedCurrency = property.currency || 'USD';
        
        // Store original values for reservation purposes
        const originalMinInvestment = property.minInvestment;
        const originalUnitPrice = property.unitPrice || property.minInvestment;
        
        // If user currency matches stored currency, no conversion needed
        if (userCurrency === storedCurrency) {
          return {
            ...property,
            userCurrency,
            originalMinInvestment,
            originalUnitPrice,
            originalCurrency: storedCurrency
          };
        }

        // Convert from stored currency to user currency
        return {
          ...property,
          totalValue: convertCurrency(property.totalValue, storedCurrency, userCurrency, rates),
          minInvestment: convertCurrency(property.minInvestment, storedCurrency, userCurrency, rates),
          unitPrice: convertCurrency(property.unitPrice || property.minInvestment, storedCurrency, userCurrency, rates),
          userCurrency,
          originalMinInvestment,
          originalUnitPrice,
          originalCurrency: storedCurrency
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
  app.get("/api/properties/:id/verification", requireApprovedUser, async (req: any, res) => {
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

  // Generic location-based scraping endpoints (supports jahi, lugbe, etc.)
  app.get("/api/scrape/:location-html", async (req, res) => {
    try {
      const location = req.params.location;
      const persist = req.query.persist === '1';
      
      // For guzape, use the existing implementation
      if (location === 'guzape') {
        const { fetchGuzapeRawHtml, persistGuzapeHtml } = await import('./scrape/guzapeHtml');
        const html = await fetchGuzapeRawHtml();
        if (persist) {
          await persistGuzapeHtml(html);
        }
        return res.type('text/html').status(200).send(html);
      }
      
      // For other locations, they use the same pattern as Guzape - market insights pages
      // Data is extracted via /api/scrape/:location-graphs endpoint directly from PropertyPro.ng
      // This endpoint just confirms the location data is accessible
      console.log(`Verifying ${location} market insights from PropertyPro.ng...`);
      
      const url = `https://propertypro.ng/index/sale/all/abuja/${location.toLowerCase()}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: `Failed to fetch ${location} page from PropertyPro.ng`,
          message: `HTTP ${response.status}` 
        });
      }
      
      const html = await response.text();
      
      // Check if the page has chart data
      const hasChartData = html.includes('renderGlobalChart') && html.includes('propertyChart');
      
      if (!hasChartData) {
        return res.status(404).json({ 
          error: `No market insights data found for ${location}`,
          message: 'PropertyPro.ng may not have market insights for this location' 
        });
      }
      
      // Optionally persist HTML to file system for reference
      if (persist) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const publicDir = path.join(process.cwd(), 'public');
        const filePath = path.join(publicDir, `${location}.html`);
        
        try {
          await fs.mkdir(publicDir, { recursive: true });
          await fs.writeFile(filePath, html, 'utf8');
          console.log(`Persisted ${location} HTML to ${filePath}`);
        } catch (err) {
          console.error(`Failed to persist ${location} HTML:`, err);
        }
      }
      
      res.json({ 
        success: true, 
        location,
        hasChartData,
        message: `Market insights data is available for ${location}. Use /api/scrape/${location}-graphs to access the data.`
      });
    } catch (err: any) {
      res.status(503).json({ 
        error: err?.message || 'scrape failed', 
        hint: 'network/selectors/robots' 
      });
    }
  });

  // Generic location-based graph data endpoint
  app.get("/api/scrape/:location-graphs", async (req, res) => {
    try {
      const location = req.params.location;
      
      // For guzape, use the existing implementation with embedded price history
      if (location === 'guzape') {
        const { getGraphDataFromFile } = await import('./scrape/guzapeGraphs');
        const graphData = await getGraphDataFromFile();
        return res.json(graphData);
      }
      
      // For other locations (Jahi, Lugbe), extract from PropertyPro.ng HTML
      console.log(`Extracting chart data for ${location} from PropertyPro.ng...`);
      
      const url = `https://propertypro.ng/index/sale/all/abuja/${location.toLowerCase()}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: `Failed to fetch ${location} data from PropertyPro.ng`,
          message: `HTTP ${response.status}`
        });
      }
      
      const html = await response.text();
      
      // Extract renderGlobalChart calls - these contain the price and index data
      // Pattern: renderGlobalChart([years], [values], 'chartId') - handles scientific notation
      const priceChartMatch = html.match(/renderGlobalChart\s*\(\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*,\s*['"]propertyChart['"]\s*\)/);
      const indexChartMatch = html.match(/renderGlobalChart\s*\(\s*\[([^\]]+)\]\s*,\s*\[([^\]]+)\]\s*,\s*['"]indexChart['"]\s*\)/);
      
      if (!priceChartMatch) {
        console.error(`No propertyChart data found for ${location}`);
        return res.status(404).json({ 
          error: `No price chart data found for ${location}`,
          hint: 'PropertyPro.ng may not have price history for this location' 
        });
      }
      
      if (!indexChartMatch) {
        console.error(`No indexChart data found for ${location}`);
        return res.status(404).json({ 
          error: `No index chart data found for ${location}`,
          hint: 'PropertyPro.ng may not have index history for this location' 
        });
      }
      
      // Parse the data arrays with validation
      const parseNumericArray = (str: string, arrayName: string): number[] => {
        return str.split(',')
          .map((v: string) => parseFloat(v.trim()))
          .filter(v => !isNaN(v) && isFinite(v));
      };
      
      const priceYears = parseNumericArray(priceChartMatch[1], 'priceYears');
      const priceValues = parseNumericArray(priceChartMatch[2], 'priceValues');
      const indexYears = parseNumericArray(indexChartMatch[1], 'indexYears');
      const indexValues = parseNumericArray(indexChartMatch[2], 'indexValues');
      
      // Validate we have data
      if (priceYears.length === 0 || priceValues.length === 0) {
        console.error(`Invalid price chart data for ${location}: years=${priceYears.length}, values=${priceValues.length}`);
        return res.status(500).json({ 
          error: `Invalid price chart data for ${location}`,
          hint: 'Failed to parse price data from PropertyPro.ng' 
        });
      }
      
      if (indexYears.length === 0 || indexValues.length === 0) {
        console.error(`Invalid index chart data for ${location}: years=${indexYears.length}, values=${indexValues.length}`);
        return res.status(500).json({ 
          error: `Invalid index chart data for ${location}`,
          hint: 'Failed to parse index data from PropertyPro.ng' 
        });
      }
      
      if (priceYears.length !== priceValues.length) {
        console.error(`Price data mismatch for ${location}: ${priceYears.length} years vs ${priceValues.length} values`);
        return res.status(500).json({ 
          error: `Inconsistent price data for ${location}`,
          hint: 'Years and values arrays have different lengths' 
        });
      }
      
      // Build price history for calculations
      const priceHistory = priceYears.map((year, idx) => ({
        year,
        price: priceValues[idx],
        index: indexValues[idx]
      }));
      
      const priceChart = {
        labels: priceYears,
        values: priceValues
      };
      
      const indexChart = {
        labels: indexYears,
        values: indexValues
      };
      
      // Extract actual historical prices from the HTML text (the cards section)
      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);
      
      // Find all historical price rows
      const historicalPriceRows = $('.historical-price-row').toArray();
      const extractedPrices: any = {};
      
      historicalPriceRows.forEach((row) => {
        const $row = $(row);
        const periodText = $row.find('p').text().trim().toLowerCase();
        const priceText = $row.find('h5').text().trim();
        const changeText = $row.find('.green-badge, .red-badge').text().trim();
        
        // Parse price (e.g., "NGN 340.00 million" or "NGN 3.50 billion")
        const priceMatch = priceText.match(/([\d,\.]+)\s*(million|billion)/i);
        const changeMatch = changeText.match(/([\d\.]+)\s*%/);
        
        if (priceMatch) {
          const numericValue = parseFloat(priceMatch[1].replace(/,/g, ''));
          const unit = priceMatch[2].toLowerCase();
          const priceValue = unit === 'billion' ? numericValue * 1_000_000_000 : numericValue * 1_000_000;
          const changeValue = changeMatch ? parseFloat(changeMatch[1]) : 0;
          const isPositive = changeText.includes('caret-up') || !changeText.includes('caret-down');
          
          const priceData = {
            price: priceText.replace(/NGN\s*/i, '₦'),
            priceValue,
            change: `${isPositive && changeValue > 0 ? '+' : ''}${changeValue.toFixed(2)}%`,
            changeValue: isPositive ? changeValue : -changeValue
          };
          
          if (periodText.includes('6 month')) {
            extractedPrices.sixMonths = { period: '6 Months', ...priceData };
          } else if (periodText.includes('1 year')) {
            extractedPrices.oneYear = { period: '1 Year', ...priceData };
          } else if (periodText.includes('2 year')) {
            extractedPrices.twoYears = { period: '2 Years', ...priceData };
          }
        }
      });
      
      // Fallback to chart data if HTML parsing fails
      const formatPrice = (value: number) => {
        if (value >= 1e9) return `₦${(value / 1e9).toFixed(1)}B`;
        if (value >= 1e6) return `₦${(value / 1e6).toFixed(0)}M`;
        return `₦${value.toLocaleString()}`;
      };
      
      const currentPrice = priceHistory[priceHistory.length - 1];
      const lastMonth = priceHistory[priceHistory.length - 2] || currentPrice;
      
      const calculateChange = (current: any, previous: any) => {
        const changePercent = ((current.price - previous.price) / previous.price) * 100;
        return {
          price: formatPrice(current.price),
          priceValue: current.price,
          change: `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`,
          changeValue: changePercent
        };
      };
      
      res.json({
        priceChart,
        indexChart,
        historicalPrices: {
          lastMonth: calculateChange(currentPrice, lastMonth),
          sixMonths: extractedPrices.sixMonths || { period: '6 Months', ...calculateChange(currentPrice, lastMonth) },
          oneYear: extractedPrices.oneYear || { period: '1 Year', ...calculateChange(currentPrice, lastMonth) },
          twoYears: extractedPrices.twoYears || { period: '2 Years', ...calculateChange(currentPrice, priceHistory[0]) }
        },
        scrapedAt: new Date().toISOString(),
        location
      });
    } catch (err: any) {
      console.error(`Error extracting graph data for ${location}:`, err);
      const errorMessage = err?.message || 'Failed to extract graph data';
      res.status(500).json({ 
        error: errorMessage,
        hint: 'Check server logs for details.' 
      });
    }
  });

  // ============================================
  // CERTIFICATE VERIFICATION ROUTES
  // ============================================
  
  // Public: Verify certificate by token (for QR code scanning)
  app.get('/api/verify/certificate/:token', async (req, res) => {
    try {
      const { token } = req.params;
      
      const certificate = await storage.getCertificateByVerificationToken(token);
      if (!certificate) {
        return res.status(404).json({ 
          verified: false,
          error: "Certificate not found or invalid" 
        });
      }

      // Get reservation for additional details
      const reservation = await storage.getReservation(certificate.reservationId);
      
      res.json({
        verified: true,
        certificate: {
          certificateNumber: certificate.certificateNumber,
          ownerName: certificate.ownerName,
          propertyName: certificate.propertyName,
          propertyLocation: certificate.propertyLocation,
          units: certificate.units,
          amount: certificate.amount,
          currency: certificate.currency,
          issuedAt: certificate.issuedAt,
          investmentStatus: reservation?.status || 'converted_to_investment'
        }
      });
    } catch (error) {
      console.error("Error verifying certificate:", error);
      res.status(500).json({ verified: false, error: "Verification failed" });
    }
  });

  // Public: Verify certificate by certificate number (for manual lookup)
  app.get('/api/verify/certificate-number/:certNumber', async (req, res) => {
    try {
      const { certNumber } = req.params;
      
      const certificate = await storage.getCertificateByCertificateNumber(certNumber);
      if (!certificate) {
        return res.status(404).json({ 
          verified: false,
          error: "Certificate not found" 
        });
      }

      // Get reservation for additional details
      const reservation = await storage.getReservation(certificate.reservationId);
      
      res.json({
        verified: true,
        certificate: {
          certificateNumber: certificate.certificateNumber,
          ownerName: certificate.ownerName,
          propertyName: certificate.propertyName,
          propertyLocation: certificate.propertyLocation,
          units: certificate.units,
          amount: certificate.amount,
          currency: certificate.currency,
          issuedAt: certificate.issuedAt,
          investmentStatus: reservation?.status || 'converted_to_investment'
        }
      });
    } catch (error) {
      console.error("Error verifying certificate by number:", error);
      res.status(500).json({ verified: false, error: "Verification failed" });
    }
  });

  // User: Get certificates for logged-in user
  app.get('/api/user/certificates', async (req, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = req.user as any;
      const certificates = await storage.getCertificatesByUserId(user.id);
      
      res.json({ certificates });
    } catch (error) {
      console.error("Error fetching user certificates:", error);
      res.status(500).json({ error: "Failed to fetch certificates" });
    }
  });

  // User: Get specific certificate with full details
  app.get('/api/user/certificates/:reservationId', async (req, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = req.user as any;
      const reservationId = parseInt(req.params.reservationId);
      
      // Verify the reservation belongs to the user
      const reservation = await storage.getReservation(reservationId);
      if (!reservation || reservation.userId !== user.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const certificate = await storage.getCertificateByReservationId(reservationId);
      if (!certificate) {
        return res.status(404).json({ error: "Certificate not found" });
      }

      // Get property for additional info
      const property = await storage.getProperty(reservation.propertyId);
      
      res.json({
        certificate,
        property: property ? {
          id: property.id,
          name: property.name,
          location: property.location,
          imageUrl: property.imageUrl
        } : null,
        verificationUrl: `${req.protocol}://${req.get('host')}/verify/${certificate.verificationToken}`
      });
    } catch (error) {
      console.error("Error fetching certificate:", error);
      res.status(500).json({ error: "Failed to fetch certificate" });
    }
  });

  const httpServer = createServer(app);

  // ==================== RESALE HELPER FUNCTIONS ====================

  async function logResaleAudit(params: {
    listingId?: number;
    bidId?: number;
    paymentId?: number;
    propertyId?: number;
    action: string;
    actorType: "user" | "admin" | "system";
    actorId?: number;
    actorName?: string;
    sellerId?: number;
    buyerId?: number;
    units?: string;
    amount?: string;
    currency?: string;
    details?: string;
    metadata?: Record<string, any>;
  }) {
    try {
      await storage.createResaleAuditLog({
        listingId: params.listingId || null,
        bidId: params.bidId || null,
        paymentId: params.paymentId || null,
        propertyId: params.propertyId || null,
        action: params.action,
        actorType: params.actorType,
        actorId: params.actorId || null,
        actorName: params.actorName || null,
        sellerId: params.sellerId || null,
        buyerId: params.buyerId || null,
        units: params.units || null,
        amount: params.amount || null,
        currency: params.currency || null,
        details: params.details || null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      });
    } catch (err) {
      console.error("[AUDIT] Failed to log resale audit:", err);
    }
  }

  async function handleNextBidderFallback(
    listing: any,
    failedBuyerId: number,
    reason: string
  ): Promise<string> {
    // Only auction listings have fallback bidders
    if (listing.sellingType !== "bidding") {
      // Fixed-price listing — just return to approved (re-list)
      await storage.updateResaleListing(listing.id, {
        status: "approved",
        winnerId: null,
        paymentDeadline: null,
        updatedAt: new Date(),
      });
      return "Fixed-price listing returned to active status.";
    }

    // Collect all failed bidder IDs for this listing
    const allBids = await storage.getBidsByListing(listing.id);
    const failedBidderIds = allBids
      .filter(b => b.status === "failed_payment" || b.bidderId === failedBuyerId)
      .map(b => b.bidderId);
    const uniqueFailedIds = [...new Set(failedBidderIds)];

    // Find next highest bidder excluding failed ones
    const nextBid = await storage.getNextHighestBidForListing(listing.id, uniqueFailedIds);

    if (!nextBid) {
      // No more bidders — return listing to active or cancel
      await storage.updateResaleListing(listing.id, {
        status: "approved",
        winnerId: null,
        highestBidId: null,
        paymentDeadline: null,
        updatedAt: new Date(),
      });
      return `${reason}. No more bidders available — listing returned to active status.`;
    }

    // Check reserve price
    if (listing.minimumPrice && parseFloat(nextBid.amount) < parseFloat(listing.minimumPrice)) {
      await storage.updateResaleListing(listing.id, {
        status: "approved",
        winnerId: null,
        highestBidId: null,
        paymentDeadline: null,
        updatedAt: new Date(),
      });
      return `${reason}. Next bidder's amount is below reserve price — listing returned to active status.`;
    }

    // Mark next bidder as the winner
    await storage.updateResaleBid(nextBid.id, { status: "won" });

    const paymentDeadline = new Date();
    paymentDeadline.setHours(paymentDeadline.getHours() + 48);

    await storage.updateResaleListing(listing.id, {
      status: "awaiting_payment",
      winnerId: nextBid.bidderId,
      highestBidId: nextBid.id,
      paymentDeadline,
      updatedAt: new Date(),
    });

    const nextBidder = await storage.getUser(nextBid.bidderId);

    await logResaleAudit({
      listingId: listing.id,
      bidId: nextBid.id,
      propertyId: listing.propertyId,
      action: "next_bidder_offered",
      actorType: "system",
      sellerId: listing.sellerId,
      buyerId: nextBid.bidderId,
      units: listing.units,
      amount: nextBid.amount,
      currency: listing.currency,
      details: `${reason}. Next bidder #${nextBid.bidderId} offered the slot with ${listing.currency} ${parseFloat(nextBid.amount).toLocaleString()}. Failed buyer: #${failedBuyerId}`,
      metadata: { failedBuyerId, reason },
    });

    try {
      const failedBuyer = await storage.getUser(failedBuyerId);
      const property = await storage.getProperty(listing.propertyId);
      if (failedBuyer && property) {
        await sendPaymentExpiredEmail(failedBuyer.email, failedBuyer.fullName || failedBuyer.email, property.name);
      }
      if (nextBidder && property) {
        await sendNextBidderOfferedEmail(
          nextBidder.email, nextBidder.fullName || nextBidder.email, property.name,
          listing.units, nextBid.amount, listing.currency, paymentDeadline
        );
      }
    } catch (emailErr) {
      console.error("[RESALE-EMAIL] Failed to send fallback emails:", emailErr);
    }

    return `${reason}. Slot offered to next highest bidder: ${nextBidder?.fullName || nextBidder?.email || `User #${nextBid.bidderId}`} (${listing.currency} ${parseFloat(nextBid.amount).toLocaleString()}).`;
  }

  // ==================== RESALE LISTING ROUTES ====================

  // Create a resale listing (seller side)
  app.post("/api/resale-listings", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const { reservationId, units, sellingType, askingPrice, minimumPrice } = req.body;

      if (!reservationId || !units || !sellingType) {
        return res.status(400).json({ message: "Missing required fields: reservationId, units, sellingType" });
      }

      if (!["fixed_price", "bidding"].includes(sellingType)) {
        return res.status(400).json({ message: "sellingType must be 'fixed_price' or 'bidding'" });
      }

      if (sellingType === "fixed_price" && !askingPrice) {
        return res.status(400).json({ message: "askingPrice is required for fixed price listings" });
      }

      const reservation = await storage.getReservation(reservationId);
      if (!reservation) {
        return res.status(404).json({ message: "Reservation not found" });
      }

      if (reservation.userId !== user.id) {
        return res.status(403).json({ message: "You can only sell units from your own investments" });
      }

      if (reservation.status !== "converted_to_investment") {
        return res.status(400).json({ message: "Only confirmed investments can be listed for resale" });
      }

      const property = await storage.getProperty(reservation.propertyId);
      if (!property || !property.isTransferable) {
        return res.status(400).json({ message: "This property does not allow unit transfers" });
      }

      const requestedUnits = parseFloat(units);
      const ownedUnits = parseFloat(reservation.units);

      if (requestedUnits <= 0 || requestedUnits > ownedUnits) {
        return res.status(400).json({ message: `You can sell between 0 and ${ownedUnits} units` });
      }

      const existingListings = await storage.getActiveResaleListingsForReservation(reservationId);
      const lockedUnits = existingListings.reduce((sum, l) => sum + parseFloat(l.units), 0);
      const availableUnits = ownedUnits - lockedUnits;

      if (requestedUnits > availableUnits) {
        return res.status(400).json({ 
          message: `Only ${availableUnits} units available for listing (${lockedUnits} already listed)` 
        });
      }

      const shareToken = randomBytes(12).toString("hex");

      const listing = await storage.createResaleListing({
        sellerId: user.id,
        propertyId: reservation.propertyId,
        reservationId,
        units: units.toString(),
        sellingType,
        askingPrice: askingPrice ? askingPrice.toString() : null,
        minimumPrice: minimumPrice ? minimumPrice.toString() : null,
        currency: reservation.currency || "NGN",
        shareToken,
      });

      await logResaleAudit({
        listingId: listing.id,
        propertyId: reservation.propertyId,
        action: "listing_created",
        actorType: "user",
        actorId: user.id,
        actorName: user.fullName || user.email,
        sellerId: user.id,
        units: units.toString(),
        amount: askingPrice?.toString(),
        currency: reservation.currency || "NGN",
        details: `${sellingType} listing created for ${units} units of ${property?.name || "property"}`,
        metadata: { sellingType, reservationId, minimumPrice },
      });

      res.status(201).json(listing);
    } catch (error: any) {
      console.error("Error creating resale listing:", error);
      res.status(500).json({ message: "Failed to create resale listing" });
    }
  });

  // Get current user's resale listings
  app.get("/api/resale-listings/mine", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const listings = await storage.getResaleListingsByUser(user.id);
      res.json(listings);
    } catch (error: any) {
      console.error("Error fetching user resale listings:", error);
      res.status(500).json({ message: "Failed to fetch resale listings" });
    }
  });

  // Cancel a resale listing (seller can cancel pending or approved listings)
  app.post("/api/resale-listings/:id/cancel", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const listingId = parseInt(req.params.id);
      const listing = await storage.getResaleListing(listingId);

      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      if (listing.sellerId !== user.id) {
        return res.status(403).json({ message: "You can only cancel your own listings" });
      }

      if (!["pending_review", "approved"].includes(listing.status)) {
        return res.status(400).json({ message: "Only pending or approved listings can be cancelled" });
      }

      const updated = await storage.updateResaleListing(listingId, { status: "cancelled" });

      await logResaleAudit({
        listingId: listing.id,
        propertyId: listing.propertyId,
        action: "listing_cancelled_by_seller",
        actorType: "user",
        actorId: user.id,
        actorName: user.fullName || user.email,
        sellerId: user.id,
        units: listing.units,
        details: `Seller cancelled listing (was ${listing.status})`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error cancelling resale listing:", error);
      res.status(500).json({ message: "Failed to cancel listing" });
    }
  });

  // Admin: Get all resale listings (enriched with seller & property info)
  app.get("/api/admin/resale-listings", requireAdminAuth, async (req: any, res) => {
    try {
      const listings = await storage.getAllResaleListings();
      const enriched = await Promise.all(listings.map(async (listing) => {
        const seller = await storage.getUser(listing.sellerId);
        const property = await storage.getProperty(listing.propertyId);
        const bids = await storage.getBidsByListing(listing.id);
        const highestBid = bids.length > 0 ? bids[0] : null;
        const winner = listing.winnerId ? await storage.getUser(listing.winnerId) : null;
        const payments = await storage.getResalePaymentsByListing(listing.id);
        const pendingPayment = payments.find(p => p.status === "pending_verification");
        const approvedPayment = payments.find(p => p.status === "approved");

        return {
          ...listing,
          sellerName: seller?.fullName || seller?.email || `User #${listing.sellerId}`,
          sellerEmail: seller?.email,
          propertyName: property?.name || `Property #${listing.propertyId}`,
          propertyLocation: property?.location,
          bidCount: bids.length,
          highestBidAmount: highestBid?.amount || null,
          highestBidderName: highestBid ? (await storage.getUser(highestBid.bidderId))?.fullName || `User #${highestBid.bidderId}` : null,
          winnerName: winner?.fullName || winner?.email || null,
          winnerEmail: winner?.email || null,
          hasPendingPayment: !!pendingPayment,
          hasApprovedPayment: !!approvedPayment,
          paymentStatus: pendingPayment ? "pending_verification" : approvedPayment ? "approved" : null,
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching all resale listings:", error);
      res.status(500).json({ message: "Failed to fetch resale listings" });
    }
  });

  // Admin: Approve or reject a resale listing
  app.post("/api/admin/resale-listings/:id/review", requireAdminAuth, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      const { action, note } = req.body;

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
      }

      const listing = await storage.getResaleListing(listingId);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      if (listing.status !== "pending_review") {
        return res.status(400).json({ message: "Only pending listings can be reviewed" });
      }

      const updated = await storage.updateResaleListing(listingId, {
        status: action === "approve" ? "approved" : "rejected",
        adminReviewNote: note || null,
        reviewedByAdminId: (req.session as any).adminUserId,
        reviewedAt: new Date(),
      });

      const seller = await storage.getUser(listing.sellerId);
      const property = await storage.getProperty(listing.propertyId);

      await logResaleAudit({
        listingId: listing.id,
        propertyId: listing.propertyId,
        action: action === "approve" ? "listing_approved" : "listing_rejected",
        actorType: "admin",
        actorId: (req.session as any).adminUserId,
        actorName: `Admin #${(req.session as any).adminUserId}`,
        sellerId: listing.sellerId,
        units: listing.units,
        details: action === "approve"
          ? `Listing approved for ${listing.units} units of ${property?.name || "property"}`
          : `Listing rejected. Reason: ${note || "No reason provided"}`,
        metadata: { adminNote: note },
      });

      try {
        if (seller && property) {
          if (action === "approve") {
            await sendListingApprovedEmail(seller.email, seller.fullName || seller.email, property.name, listing.units, listing.sellingType);
          } else {
            await sendListingRejectedEmail(seller.email, seller.fullName || seller.email, property.name, listing.units, note);
          }
        }
      } catch (emailErr) {
        console.error("[RESALE-EMAIL] Failed to send listing review email:", emailErr);
      }

      if (action === "approve" && property) {
        try {
          const reservations = await storage.getReservationsByProperty(listing.propertyId);
          const confirmedInvestors = reservations.filter(
            (r) => r.status === "converted_to_investment" && r.userId && r.userId !== listing.sellerId
          );

          const uniqueInvestorIds = [...new Set(confirmedInvestors.map((r) => r.userId!))];

          for (const investorId of uniqueInvestorIds) {
            try {
              const investor = await storage.getUser(investorId);
              if (investor) {
                await sendNewListingNotificationToCoInvestors(
                  investor.email,
                  investor.fullName || investor.email,
                  property.name,
                  listing.units,
                  listing.sellingType,
                  listing.askingPrice,
                  listing.currency,
                  updated?.shareToken || listing.shareToken || null,
                );
              }
            } catch (investorEmailErr) {
              console.error(`[RESALE-EMAIL] Failed to notify co-investor #${investorId}:`, investorEmailErr);
            }
          }
          console.log(`[RESALE-EMAIL] Notified ${uniqueInvestorIds.length} co-investors about new listing on ${property.name}`);
        } catch (coInvestorErr) {
          console.error("[RESALE-EMAIL] Failed to send co-investor notifications:", coInvestorErr);
        }
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error reviewing resale listing:", error);
      res.status(500).json({ message: "Failed to review listing" });
    }
  });

  // Admin: Force cancel a listing
  app.post("/api/admin/resale-listings/:id/cancel", requireAdminAuth, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      const { note } = req.body || {};

      const listing = await storage.getResaleListing(listingId);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      if (listing.status === "sold") {
        return res.status(400).json({ message: "Cannot cancel a completed sale" });
      }

      if (listing.status === "cancelled") {
        return res.status(400).json({ message: "Listing is already cancelled" });
      }

      // If awaiting_payment, mark all pending payments as rejected
      if (listing.status === "awaiting_payment") {
        const payments = await storage.getResalePaymentsByListing(listingId);
        for (const payment of payments) {
          if (payment.status === "pending_verification") {
            await storage.updateResalePayment(payment.id, {
              status: "rejected",
              rejectionReason: "Listing cancelled by admin",
              reviewedByAdminId: (req.session as any).adminUserId,
              reviewedAt: new Date(),
            });
          }
        }
      }

      // If bidding, mark all active bids as lost
      if (listing.sellingType === "bidding") {
        const bids = await storage.getBidsByListing(listingId);
        for (const bid of bids) {
          if (bid.status === "active" || bid.status === "outbid") {
            await storage.updateResaleBid(bid.id, { status: "lost" });
          }
        }
      }

      const updated = await storage.updateResaleListing(listingId, {
        status: "cancelled",
        adminReviewNote: note || "Cancelled by admin",
        reviewedByAdminId: (req.session as any).adminUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      });

      await logResaleAudit({
        listingId: listing.id,
        propertyId: listing.propertyId,
        action: "listing_cancelled_by_admin",
        actorType: "admin",
        actorId: (req.session as any).adminUserId,
        actorName: `Admin #${(req.session as any).adminUserId}`,
        sellerId: listing.sellerId,
        units: listing.units,
        details: `Listing force-cancelled by admin. Reason: ${note || "No reason"}`,
      });

      res.json({ message: "Listing cancelled successfully", listing: updated });
    } catch (error: any) {
      console.error("Error cancelling listing:", error);
      res.status(500).json({ message: "Failed to cancel listing" });
    }
  });

  // Public (approved users): Get active resale listings for a property
  app.get("/api/properties/:id/resale-listings", requireApprovedUser, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const listings = await storage.getResaleListingsByProperty(propertyId);
      const activeListings = listings.filter(l => l.status === "approved");
      res.json(activeListings);
    } catch (error: any) {
      console.error("Error fetching property resale listings:", error);
      res.status(500).json({ message: "Failed to fetch resale listings" });
    }
  });

  // ==================== PUBLIC LISTING ROUTE ====================

  app.get("/api/public/listing/:shareToken", async (req, res) => {
    try {
      const { shareToken } = req.params;
      const listing = await storage.getResaleListingByShareToken(shareToken);

      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      if (!["approved", "awaiting_payment", "sold"].includes(listing.status)) {
        return res.status(404).json({ message: "Listing is not available" });
      }

      const property = await storage.getProperty(listing.propertyId);
      const seller = await storage.getUser(listing.sellerId);

      let highestBidAmount: string | null = null;
      let bidCount = 0;
      if (listing.sellingType === "bidding") {
        const highestBid = await storage.getHighestBidForListing(listing.id);
        highestBidAmount = highestBid?.amount || null;
        const bids = await storage.getBidsByListing(listing.id);
        bidCount = bids.filter(b => b.status === "active").length;
      }

      res.json({
        id: listing.id,
        propertyId: listing.propertyId,
        units: listing.units,
        sellingType: listing.sellingType,
        askingPrice: listing.askingPrice,
        minimumPrice: listing.minimumPrice,
        currency: listing.currency,
        status: listing.status,
        biddingEndsAt: listing.biddingEndsAt,
        createdAt: listing.createdAt,
        shareToken: listing.shareToken,
        propertyName: property?.name || "Property",
        propertyLocation: property?.location || "",
        propertyImageUrl: property?.imageUrl || null,
        propertyType: property?.propertyType || "",
        propertyDescription: property?.description || "",
        sellerName: seller?.fullName || "Anonymous",
        highestBidAmount,
        bidCount,
      });
    } catch (error: any) {
      console.error("Error fetching public listing:", error);
      res.status(500).json({ message: "Failed to fetch listing" });
    }
  });

  // ==================== MARKETPLACE ROUTES ====================

  // Get all approved resale listings (marketplace) - enriched with property & bid info
  app.get("/api/marketplace/listings-public", async (req: any, res) => {
    try {
      const listings = await storage.getActiveResaleListings();
      const enriched = await Promise.all(listings.map(async (listing) => {
        const property = await storage.getProperty(listing.propertyId);
        const highestBid = listing.sellingType === "bidding" 
          ? await storage.getHighestBidForListing(listing.id) 
          : undefined;
        const bidCount = listing.sellingType === "bidding"
          ? (await storage.getBidsByListing(listing.id)).filter(b => b.status === "active").length
          : 0;
        return {
          id: listing.id,
          propertyId: listing.propertyId,
          units: listing.units,
          sellingType: listing.sellingType,
          askingPrice: listing.askingPrice,
          minimumPrice: listing.minimumPrice,
          currency: listing.currency,
          status: listing.status,
          biddingEndsAt: listing.biddingEndsAt,
          shareToken: listing.shareToken,
          propertyName: property?.name,
          propertyLocation: property?.location,
          propertyImageUrl: property?.imageUrl,
          highestBidAmount: highestBid?.amount || null,
          bidCount,
          sellerName: "Brikvest Member",
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching public marketplace listings:", error);
      res.status(500).json({ message: "Failed to fetch marketplace listings" });
    }
  });

  app.get("/api/marketplace/listings", requireApprovedUser, async (req: any, res) => {
    try {
      const listings = await storage.getActiveResaleListings();
      const enriched = await Promise.all(listings.map(async (listing) => {
        const property = await storage.getProperty(listing.propertyId);
        const seller = await storage.getUser(listing.sellerId);
        const highestBid = listing.sellingType === "bidding" 
          ? await storage.getHighestBidForListing(listing.id) 
          : undefined;
        const bidCount = listing.sellingType === "bidding"
          ? (await storage.getBidsByListing(listing.id)).filter(b => b.status === "active").length
          : 0;
        return {
          ...listing,
          propertyName: property?.name,
          propertyLocation: property?.location,
          propertyImageUrl: property?.imageUrl,
          propertyType: property?.propertyType,
          sellerName: seller?.fullName || "Anonymous",
          highestBidAmount: highestBid?.amount || null,
          bidCount,
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching marketplace listings:", error);
      res.status(500).json({ message: "Failed to fetch marketplace listings" });
    }
  });

  // Get single listing detail with bids
  app.get("/api/marketplace/listings/:id", requireApprovedUser, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      const listing = await storage.getResaleListing(listingId);
      if (!listing || !["approved", "awaiting_payment", "sold"].includes(listing.status)) {
        return res.status(404).json({ message: "Listing not found" });
      }
      const property = await storage.getProperty(listing.propertyId);
      const seller = await storage.getUser(listing.sellerId);
      const bids = listing.sellingType === "bidding" 
        ? await storage.getBidsByListing(listing.id)
        : [];
      const highestBid = bids.find(b => b.status === "active" || b.status === "won");

      const enrichedBids = await Promise.all(bids.map(async (bid) => {
        const bidder = await storage.getUser(bid.bidderId);
        return {
          ...bid,
          bidderName: bidder?.fullName || "Anonymous",
        };
      }));

      res.json({
        ...listing,
        propertyName: property?.name,
        propertyLocation: property?.location,
        propertyImageUrl: property?.imageUrl,
        propertyType: property?.propertyType,
        sellerName: seller?.fullName || "Anonymous",
        highestBidAmount: highestBid?.amount || null,
        bidCount: bids.filter(b => b.status === "active").length,
        bids: enrichedBids,
      });
    } catch (error: any) {
      console.error("Error fetching listing detail:", error);
      res.status(500).json({ message: "Failed to fetch listing" });
    }
  });

  // Place a bid on a bidding listing
  app.post("/api/marketplace/listings/:id/bid", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const listingId = parseInt(req.params.id);
      const { amount } = req.body;

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: "Invalid bid amount" });
      }

      // KYC verification required to bid
      if (user.kycStatus !== "approved") {
        return res.status(403).json({ message: "You must complete KYC verification before placing bids" });
      }

      const listing = await storage.getResaleListing(listingId);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      if (listing.status !== "approved") {
        return res.status(400).json({ message: "This listing is not accepting bids" });
      }
      if (listing.sellingType !== "bidding") {
        return res.status(400).json({ message: "This is not a bidding listing" });
      }
      // Prevent seller from bidding on their own listing
      if (listing.sellerId === user.id) {
        return res.status(400).json({ message: "You cannot bid on your own listing" });
      }
      if (listing.biddingEndsAt && new Date(listing.biddingEndsAt) < new Date()) {
        return res.status(400).json({ message: "Bidding has ended for this listing" });
      }

      const bidAmount = parseFloat(amount);

      if (listing.minimumPrice && bidAmount < parseFloat(listing.minimumPrice)) {
        return res.status(400).json({ message: `Bid must be at least ${listing.currency} ${parseFloat(listing.minimumPrice).toLocaleString()} (reserve price)` });
      }

      const highestBid = await storage.getHighestBidForListing(listingId);
      if (highestBid && bidAmount <= parseFloat(highestBid.amount)) {
        return res.status(400).json({ message: `Bid must be higher than the current highest bid of ${listing.currency} ${parseFloat(highestBid.amount).toLocaleString()}` });
      }

      // Mark previous highest bid as outbid
      if (highestBid) {
        await storage.updateResaleBid(highestBid.id, { status: "outbid" });
      }

      const bid = await storage.createResaleBid({
        listingId,
        bidderId: user.id,
        amount: amount.toString(),
        currency: listing.currency,
      });

      // Update listing with highest bid reference
      const listingUpdates: any = { highestBidId: bid.id };

      // Anti-sniping: if bid placed within last 5 minutes of auction, extend by 5 minutes
      if (listing.biddingEndsAt) {
        const now = new Date();
        const endsAt = new Date(listing.biddingEndsAt);
        const fiveMinutes = 5 * 60 * 1000;
        if (endsAt.getTime() - now.getTime() < fiveMinutes && endsAt.getTime() > now.getTime()) {
          const newEndTime = new Date(now.getTime() + fiveMinutes);
          listingUpdates.biddingEndsAt = newEndTime;
        }
      }

      await storage.updateResaleListing(listingId, listingUpdates);

      await logResaleAudit({
        listingId,
        bidId: bid.id,
        propertyId: listing.propertyId,
        action: "bid_placed",
        actorType: "user",
        actorId: user.id,
        actorName: user.fullName || user.email,
        sellerId: listing.sellerId,
        buyerId: user.id,
        units: listing.units,
        amount: amount.toString(),
        currency: listing.currency,
        details: `Bid of ${listing.currency} ${amount.toLocaleString()} placed${listingUpdates.biddingEndsAt && listingUpdates.biddingEndsAt !== listing.biddingEndsAt ? " (anti-snipe: auction extended 5min)" : ""}`,
        metadata: { previousHighestBid: highestBid?.amount, antiSnipeTriggered: !!listingUpdates.biddingEndsAt && listingUpdates.biddingEndsAt !== listing.biddingEndsAt },
      });

      // Send email notifications
      try {
        const seller = await storage.getUser(listing.sellerId);
        const property = await storage.getProperty(listing.propertyId);
        const allBids = await storage.getBidsByListing(listingId);

        if (seller && property) {
          await sendNewBidNotificationEmail(
            seller.email, seller.fullName || seller.email, property.name,
            user.fullName || user.email, amount.toString(), listing.currency, allBids.length
          );
        }

        // Notify outbid user
        if (highestBid && highestBid.bidderId !== user.id) {
          const outbidUser = await storage.getUser(highestBid.bidderId);
          if (outbidUser && property) {
            await sendOutbidEmail(
              outbidUser.email, outbidUser.fullName || outbidUser.email, property.name,
              highestBid.amount, amount.toString(), listing.currency
            );
          }
        }

        // Confirm highest bidder status to new bidder
        if (property) {
          await sendHighestBidderEmail(user.email, user.fullName || user.email, property.name, amount.toString(), listing.currency);
        }
      } catch (emailErr) {
        console.error("[RESALE-EMAIL] Failed to send bid notification emails:", emailErr);
      }

      res.status(201).json({
        ...bid,
        auctionExtended: !!listingUpdates.biddingEndsAt && listingUpdates.biddingEndsAt !== listing.biddingEndsAt,
      });
    } catch (error: any) {
      console.error("Error placing bid:", error);
      res.status(500).json({ message: "Failed to place bid" });
    }
  });

  // Buy fixed-price listing
  app.post("/api/marketplace/listings/:id/buy", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const listingId = parseInt(req.params.id);

      // KYC verification required to buy
      if (user.kycStatus !== "approved") {
        return res.status(403).json({ message: "You must complete KYC verification before purchasing units" });
      }

      const listing = await storage.getResaleListing(listingId);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      if (listing.status !== "approved") {
        return res.status(400).json({ message: "This listing is no longer available" });
      }
      if (listing.sellingType !== "fixed_price") {
        return res.status(400).json({ message: "This listing requires bidding, not direct purchase" });
      }
      // Prevent seller from buying their own listing
      if (listing.sellerId === user.id) {
        return res.status(400).json({ message: "You cannot buy your own listing" });
      }

      const paymentDeadline = new Date();
      paymentDeadline.setHours(paymentDeadline.getHours() + 48);

      const updated = await storage.updateResaleListing(listingId, {
        status: "awaiting_payment",
        winnerId: user.id,
        paymentDeadline,
      });

      await logResaleAudit({
        listingId,
        propertyId: listing.propertyId,
        action: "fixed_price_purchase",
        actorType: "user",
        actorId: user.id,
        actorName: user.fullName || user.email,
        sellerId: listing.sellerId,
        buyerId: user.id,
        units: listing.units,
        amount: listing.askingPrice || "0",
        currency: listing.currency,
        details: `Fixed-price purchase accepted. Payment deadline: ${paymentDeadline.toISOString()}`,
      });

      try {
        const property = await storage.getProperty(listing.propertyId);
        if (property) {
          await sendFixedPricePurchaseEmail(
            user.email, user.fullName || user.email, property.name,
            listing.units, listing.askingPrice || "0", listing.currency, paymentDeadline
          );
        }
      } catch (emailErr) {
        console.error("[RESALE-EMAIL] Failed to send fixed-price purchase email:", emailErr);
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error buying listing:", error);
      res.status(500).json({ message: "Failed to process purchase" });
    }
  });

  // End bidding on a listing (admin action)
  app.post("/api/admin/resale-listings/:id/end-bidding", requireAdminAuth, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      const listing = await storage.getResaleListing(listingId);

      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      if (listing.sellingType !== "bidding") {
        return res.status(400).json({ message: "Not a bidding listing" });
      }
      if (listing.status !== "approved") {
        return res.status(400).json({ message: "Listing is not active" });
      }

      const highestBid = await storage.getHighestBidForListing(listingId);
      if (!highestBid) {
        // No bids — just cancel the listing
        await storage.updateResaleListing(listingId, { status: "cancelled" });
        return res.json({ message: "No bids received. Listing cancelled.", listing: await storage.getResaleListing(listingId) });
      }

      // Check reserve price
      if (listing.minimumPrice && parseFloat(highestBid.amount) < parseFloat(listing.minimumPrice)) {
        // Reserve not met — mark all bids as lost
        const allBids = await storage.getBidsByListing(listingId);
        for (const bid of allBids) {
          if (bid.status === "active") {
            await storage.updateResaleBid(bid.id, { status: "lost" });
          }
        }
        await storage.updateResaleListing(listingId, { status: "cancelled" });
        return res.json({ message: "Reserve price not met. Listing cancelled.", listing: await storage.getResaleListing(listingId) });
      }

      // Winner found
      await storage.updateResaleBid(highestBid.id, { status: "won" });

      // Mark all other active bids as lost
      const allBids = await storage.getBidsByListing(listingId);
      for (const bid of allBids) {
        if (bid.id !== highestBid.id && (bid.status === "active" || bid.status === "outbid")) {
          await storage.updateResaleBid(bid.id, { status: "lost" });
        }
      }

      const paymentDeadline = new Date();
      paymentDeadline.setHours(paymentDeadline.getHours() + 48);

      const updated = await storage.updateResaleListing(listingId, {
        status: "awaiting_payment",
        winnerId: highestBid.bidderId,
        highestBidId: highestBid.id,
        paymentDeadline,
      });

      await logResaleAudit({
        listingId,
        bidId: highestBid.id,
        propertyId: listing.propertyId,
        action: "bidding_ended_winner_selected",
        actorType: "admin",
        actorId: (req.session as any).adminUserId,
        actorName: `Admin #${(req.session as any).adminUserId}`,
        sellerId: listing.sellerId,
        buyerId: highestBid.bidderId,
        units: listing.units,
        amount: highestBid.amount,
        currency: listing.currency,
        details: `Bidding ended. Winner: User #${highestBid.bidderId} with ${listing.currency} ${parseFloat(highestBid.amount).toLocaleString()}. Payment deadline: ${paymentDeadline.toISOString()}`,
        metadata: { totalBids: allBids.length },
      });

      try {
        const winner = await storage.getUser(highestBid.bidderId);
        const property = await storage.getProperty(listing.propertyId);
        if (winner && property) {
          await sendAuctionWonEmail(
            winner.email, winner.fullName || winner.email, property.name,
            listing.units, highestBid.amount, listing.currency, paymentDeadline
          );
        }
      } catch (emailErr) {
        console.error("[RESALE-EMAIL] Failed to send auction won email:", emailErr);
      }

      res.json({ message: "Bidding ended. Winner selected.", listing: updated });
    } catch (error: any) {
      console.error("Error ending bidding:", error);
      res.status(500).json({ message: "Failed to end bidding" });
    }
  });

  // Get user's bids
  app.get("/api/resale-bids/mine", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const bids = await storage.getBidsByUser(user.id);
      const enriched = await Promise.all(bids.map(async (bid) => {
        const listing = await storage.getResaleListing(bid.listingId);
        const property = listing ? await storage.getProperty(listing.propertyId) : null;
        return {
          ...bid,
          listing: listing ? {
            id: listing.id,
            units: listing.units,
            sellingType: listing.sellingType,
            status: listing.status,
            currency: listing.currency,
          } : null,
          propertyName: property?.name || "Unknown",
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching user bids:", error);
      res.status(500).json({ message: "Failed to fetch bids" });
    }
  });

  // Get listings where the current user is the winner (awaiting payment)
  app.get("/api/resale-listings/won", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const allListings = await storage.getAllResaleListings();
      const wonListings = allListings.filter(l => l.winnerId === user.id && l.status === "awaiting_payment");
      const enriched = await Promise.all(wonListings.map(async (listing) => {
        const property = await storage.getProperty(listing.propertyId);
        const seller = await storage.getUser(listing.sellerId);
        let highestBidAmount = null;
        if (listing.highestBidId) {
          const bid = await storage.getResaleBid(listing.highestBidId);
          if (bid) highestBidAmount = bid.amount;
        }
        return {
          ...listing,
          propertyName: property?.name || `Property #${listing.propertyId}`,
          propertyLocation: property?.location,
          sellerName: seller?.fullName || seller?.email || "Unknown",
          highestBidAmount,
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching won listings:", error);
      res.status(500).json({ message: "Failed to fetch won listings" });
    }
  });

  // Buyer: Submit resale payment confirmation
  app.post("/api/resale-payments", requireApprovedUser, upload.single('paymentProof'), async (req: any, res) => {
    try {
      const user = req.user as any;
      const { listingId, bankReference } = req.body;
      const file = req.file;

      if (!listingId) {
        return res.status(400).json({ message: "Listing ID is required" });
      }

      const listing = await storage.getResaleListing(parseInt(listingId));
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      if (listing.status !== "awaiting_payment") {
        return res.status(400).json({ message: "This listing is not awaiting payment" });
      }

      if (listing.winnerId !== user.id) {
        return res.status(403).json({ message: "You are not the designated buyer for this listing" });
      }

      if (listing.paymentDeadline && new Date(listing.paymentDeadline) < new Date()) {
        return res.status(400).json({ message: "Payment deadline has passed. The listing may be offered to the next bidder." });
      }

      const existingPayments = await storage.getResalePaymentsByListing(parseInt(listingId));
      const hasPending = existingPayments.some(p => p.status === "pending_verification");
      if (hasPending) {
        return res.status(400).json({ message: "A payment is already pending verification for this listing" });
      }

      // Payment retry limit: max 3 attempts per buyer per listing
      const MAX_PAYMENT_ATTEMPTS = 3;
      const buyerAttempts = existingPayments.filter(p => p.buyerId === user.id);
      const rejectedAttempts = buyerAttempts.filter(p => p.status === "rejected");
      if (rejectedAttempts.length >= MAX_PAYMENT_ATTEMPTS) {
        return res.status(400).json({ 
          message: `You have exceeded the maximum of ${MAX_PAYMENT_ATTEMPTS} payment attempts for this listing. The slot will be offered to the next bidder.` 
        });
      }

      let proofUrl: string | null = null;
      let proofType: string | null = null;
      if (file) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
        if (!allowedTypes.includes(file.mimetype)) {
          return res.status(400).json({ message: "Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed." });
        }
        if (file.size > 10 * 1024 * 1024) {
          return res.status(400).json({ message: "File size exceeds 10MB limit." });
        }
        if (file.mimetype === 'application/pdf') {
          proofUrl = await uploadToObjectStorage(file.buffer, file.originalname, file.mimetype, 'resale-payment-proofs');
        } else {
          const result = await uploadToCloudinary(file.buffer, file.originalname, 'brikvest/resale-payment-proofs');
          proofUrl = result.url;
        }
        proofType = file.mimetype === 'application/pdf' ? 'pdf' : 'image';
      }

      let finalAmount = listing.askingPrice || "0";
      if (listing.sellingType === "bidding" && listing.highestBidId) {
        const winningBid = await storage.getResaleBid(listing.highestBidId);
        if (winningBid) finalAmount = winningBid.amount;
      }

      const attemptNumber = rejectedAttempts.length + 1;

      const payment = await storage.createResalePayment({
        listingId: parseInt(listingId),
        buyerId: user.id,
        amount: finalAmount,
        currency: listing.currency || "NGN",
        paymentMethod: "bank_transfer",
        bankReference: bankReference || null,
        proofUrl,
        proofType,
        attemptNumber,
      });

      await logResaleAudit({
        listingId: parseInt(listingId),
        paymentId: payment.id,
        propertyId: listing.propertyId,
        action: "payment_submitted",
        actorType: "user",
        actorId: user.id,
        actorName: user.fullName || user.email,
        sellerId: listing.sellerId,
        buyerId: user.id,
        amount: finalAmount,
        currency: listing.currency || "NGN",
        details: `Payment proof submitted (attempt ${attemptNumber}/${MAX_PAYMENT_ATTEMPTS}). Bank ref: ${bankReference || "N/A"}`,
        metadata: { attemptNumber, bankReference, hasProof: !!proofUrl },
      });

      res.json({
        message: "Payment confirmation submitted. Please wait for admin verification.",
        payment,
        attemptsRemaining: MAX_PAYMENT_ATTEMPTS - attemptNumber,
      });
    } catch (error: any) {
      console.error("Error submitting resale payment:", error);
      res.status(500).json({ message: "Failed to submit payment confirmation" });
    }
  });

  // Buyer: Get their resale payments
  app.get("/api/resale-payments/mine", requireApprovedUser, async (req: any, res) => {
    try {
      const user = req.user as any;
      const payments = await storage.getResalePaymentsByBuyer(user.id);
      res.json(payments);
    } catch (error: any) {
      console.error("Error fetching resale payments:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // Get resale payment for a specific listing (buyer check)
  app.get("/api/resale-payments/listing/:listingId", requireApprovedUser, async (req: any, res) => {
    try {
      const payments = await storage.getResalePaymentsByListing(parseInt(req.params.listingId));
      res.json(payments);
    } catch (error: any) {
      console.error("Error fetching listing payments:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // Admin: Get all resale payments
  app.get("/api/admin/resale-payments", requireAdminAuth, async (req: any, res) => {
    try {
      const payments = await storage.getAllResalePayments();
      const enriched = await Promise.all(payments.map(async (payment) => {
        const listing = await storage.getResaleListing(payment.listingId);
        const buyer = await storage.getUser(payment.buyerId);
        const property = listing ? await storage.getProperty(listing.propertyId) : null;
        const seller = listing ? await storage.getUser(listing.sellerId) : null;
        return {
          ...payment,
          buyerName: buyer?.fullName || buyer?.email || `User #${payment.buyerId}`,
          buyerEmail: buyer?.email,
          sellerName: seller?.fullName || seller?.email || "Unknown",
          sellerEmail: seller?.email,
          propertyName: property?.name || "Unknown",
          listingUnits: listing?.units,
          listingType: listing?.sellingType,
          listingStatus: listing?.status,
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching admin resale payments:", error);
      res.status(500).json({ message: "Failed to fetch resale payments" });
    }
  });

  // Admin: Approve or reject resale payment
  app.post("/api/admin/resale-payments/:id/review", requireAdminAuth, async (req: any, res) => {
    try {
      const paymentId = parseInt(req.params.id);
      const { action, rejectionReason } = req.body;

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
      }

      const payment = await storage.getResalePayment(paymentId);
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }

      if (payment.status !== "pending_verification") {
        return res.status(400).json({ message: "Only pending payments can be reviewed" });
      }

      const listing = await storage.getResaleListing(payment.listingId);
      if (!listing) {
        return res.status(404).json({ message: "Associated listing not found" });
      }

      if (action === "approve") {
        await storage.updateResalePayment(paymentId, {
          status: "approved",
          reviewedByAdminId: (req.session as any).adminUserId,
          reviewedAt: new Date(),
        });

        await storage.updateResaleListing(payment.listingId, {
          status: "sold",
          updatedAt: new Date(),
        });

        const sellerReservation = await storage.getReservation(listing.reservationId);
        if (sellerReservation) {
          const currentUnits = parseFloat(String(sellerReservation.units || 0));
          const soldUnits = parseFloat(String(listing.units));
          const remainingUnits = currentUnits - soldUnits;

          if (remainingUnits <= 0) {
            await storage.updateReservation(listing.reservationId, {
              status: "sold_via_resale",
              units: "0",
            });
          } else {
            await storage.updateReservation(listing.reservationId, {
              units: String(remainingUnits),
            });
          }
        }

        const property = await storage.getProperty(listing.propertyId);
        const buyer = await storage.getUser(payment.buyerId);

        if (property && buyer) {
          await storage.createInvestmentReservation({
            propertyId: listing.propertyId,
            userId: payment.buyerId,
            units: String(listing.units),
            amount: payment.amount,
            currency: payment.currency || "NGN",
            status: "converted_to_investment",
            expiresAt: new Date(),
          });
        }

        await logResaleAudit({
          listingId: payment.listingId,
          paymentId: paymentId,
          propertyId: listing.propertyId,
          action: "payment_approved_transfer_complete",
          actorType: "admin",
          actorId: (req.session as any).adminUserId,
          actorName: `Admin #${(req.session as any).adminUserId}`,
          sellerId: listing.sellerId,
          buyerId: payment.buyerId,
          units: listing.units,
          amount: payment.amount,
          currency: payment.currency || "NGN",
          details: `Payment approved. Units transferred from seller #${listing.sellerId} to buyer #${payment.buyerId}. Listing marked as sold.`,
          metadata: { bankReference: payment.bankReference },
        });

        try {
          const seller = await storage.getUser(listing.sellerId);
          const property2 = property || await storage.getProperty(listing.propertyId);
          const buyer2 = buyer || await storage.getUser(payment.buyerId);
          if (buyer2 && property2) {
            await sendPaymentApprovedEmail(
              buyer2.email, buyer2.fullName || buyer2.email, property2.name,
              listing.units, payment.amount, payment.currency || "NGN"
            );
          }
          if (seller && property2 && buyer2) {
            await sendTransferCompleteToSellerEmail(
              seller.email, seller.fullName || seller.email, property2.name,
              listing.units, payment.amount, payment.currency || "NGN",
              buyer2.fullName || buyer2.email
            );
          }
        } catch (emailErr) {
          console.error("[RESALE-EMAIL] Failed to send transfer complete emails:", emailErr);
        }

        res.json({
          message: "Payment approved. Units transferred to buyer, listing marked as sold.",
        });
      } else {
        await storage.updateResalePayment(paymentId, {
          status: "rejected",
          rejectionReason: rejectionReason || "Payment could not be verified",
          reviewedByAdminId: (req.session as any).adminUserId,
          reviewedAt: new Date(),
        });

        // Check if buyer has exhausted retry attempts
        const MAX_PAYMENT_ATTEMPTS = 3;
        const allListingPayments = await storage.getResalePaymentsByListing(payment.listingId);
        const buyerRejections = allListingPayments.filter(p => p.buyerId === payment.buyerId && p.status === "rejected");

        await logResaleAudit({
          listingId: payment.listingId,
          paymentId: paymentId,
          propertyId: listing.propertyId,
          action: "payment_rejected",
          actorType: "admin",
          actorId: (req.session as any).adminUserId,
          actorName: `Admin #${(req.session as any).adminUserId}`,
          sellerId: listing.sellerId,
          buyerId: payment.buyerId,
          amount: payment.amount,
          currency: payment.currency || "NGN",
          details: `Payment rejected. Reason: ${rejectionReason || "Not verified"}. Attempts used: ${buyerRejections.length}/${MAX_PAYMENT_ATTEMPTS}`,
          metadata: { rejectionReason, attemptsUsed: buyerRejections.length },
        });

        try {
          const buyerUser = await storage.getUser(payment.buyerId);
          const property3 = await storage.getProperty(listing.propertyId);
          if (buyerUser && property3) {
            await sendPaymentRejectedEmail(
              buyerUser.email, buyerUser.fullName || buyerUser.email, property3.name,
              payment.amount, payment.currency || "NGN",
              rejectionReason || "Payment could not be verified",
              MAX_PAYMENT_ATTEMPTS - buyerRejections.length
            );
          }
        } catch (emailErr) {
          console.error("[RESALE-EMAIL] Failed to send payment rejected email:", emailErr);
        }

        if (buyerRejections.length >= MAX_PAYMENT_ATTEMPTS) {
          const fallbackResult = await handleNextBidderFallback(listing, payment.buyerId, "Payment retries exhausted");
          res.json({
            message: `Payment rejected. Buyer exceeded ${MAX_PAYMENT_ATTEMPTS} attempts. ${fallbackResult}`,
          });
        } else {
          res.json({
            message: `Payment rejected. Buyer can retry (${MAX_PAYMENT_ATTEMPTS - buyerRejections.length} attempt(s) remaining).`,
          });
        }
      }
    } catch (error: any) {
      console.error("Error reviewing resale payment:", error);
      res.status(500).json({ message: "Failed to review payment" });
    }
  });

  // Admin: Handle expired payment deadline — offer to next bidder
  app.post("/api/admin/resale-listings/:id/expire-payment", requireAdminAuth, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      const listing = await storage.getResaleListing(listingId);

      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      if (listing.status !== "awaiting_payment") {
        return res.status(400).json({ message: "Listing is not in awaiting_payment status" });
      }

      const failedBuyerId = listing.winnerId;
      if (!failedBuyerId) {
        return res.status(400).json({ message: "No winner to expire" });
      }

      // Mark the current winner's bid as failed_payment
      if (listing.highestBidId) {
        const winnerBid = await storage.getResaleBid(listing.highestBidId);
        if (winnerBid && winnerBid.bidderId === failedBuyerId) {
          await storage.updateResaleBid(winnerBid.id, { status: "failed_payment", failureReason: "Payment deadline expired" });
        }
      }

      // Reject any pending payments
      const payments = await storage.getResalePaymentsByListing(listingId);
      for (const p of payments) {
        if (p.status === "pending_verification" && p.buyerId === failedBuyerId) {
          await storage.updateResalePayment(p.id, {
            status: "rejected",
            rejectionReason: "Payment deadline expired",
            reviewedByAdminId: (req.session as any).adminUserId,
            reviewedAt: new Date(),
          });
        }
      }

      await logResaleAudit({
        listingId,
        propertyId: listing.propertyId,
        action: "payment_deadline_expired",
        actorType: "admin",
        actorId: (req.session as any).adminUserId,
        actorName: `Admin #${(req.session as any).adminUserId}`,
        sellerId: listing.sellerId,
        buyerId: failedBuyerId,
        units: listing.units,
        details: `Payment deadline expired for buyer #${failedBuyerId}. Admin triggered next-bidder fallback.`,
      });

      const fallbackResult = await handleNextBidderFallback(listing, failedBuyerId, "Payment deadline expired");
      res.json({ message: fallbackResult });
    } catch (error: any) {
      console.error("Error expiring payment:", error);
      res.status(500).json({ message: "Failed to process payment expiry" });
    }
  });

  // ==================== RESALE AUDIT LOG ADMIN ROUTES ====================

  app.get("/api/admin/resale-audit-logs", requireAdminAuth, async (req: any, res) => {
    try {
      const { listingId, propertyId, limit: limitParam } = req.query;
      let logs;
      if (listingId) {
        logs = await storage.getResaleAuditLogsByListing(parseInt(listingId));
      } else if (propertyId) {
        logs = await storage.getResaleAuditLogsByProperty(parseInt(propertyId));
      } else {
        logs = await storage.getAllResaleAuditLogs(limitParam ? parseInt(limitParam) : 500);
      }

      const enriched = await Promise.all(logs.map(async (log) => {
        const seller = log.sellerId ? await storage.getUser(log.sellerId) : null;
        const buyer = log.buyerId ? await storage.getUser(log.buyerId) : null;
        const property = log.propertyId ? await storage.getProperty(log.propertyId) : null;
        return {
          ...log,
          sellerName: seller?.fullName || seller?.email || null,
          buyerName: buyer?.fullName || buyer?.email || null,
          propertyName: property?.name || null,
        };
      }));

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching resale audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/admin/resale-audit-logs/listing/:id", requireAdminAuth, async (req: any, res) => {
    try {
      const listingId = parseInt(req.params.id);
      const logs = await storage.getResaleAuditLogsByListing(listingId);
      const listing = await storage.getResaleListing(listingId);

      const enriched = await Promise.all(logs.map(async (log) => {
        const seller = log.sellerId ? await storage.getUser(log.sellerId) : null;
        const buyer = log.buyerId ? await storage.getUser(log.buyerId) : null;
        const property = log.propertyId ? await storage.getProperty(log.propertyId) : null;
        return {
          ...log,
          sellerName: seller?.fullName || seller?.email || null,
          buyerName: buyer?.fullName || buyer?.email || null,
          propertyName: property?.name || null,
        };
      }));

      res.json({ listing, timeline: enriched });
    } catch (error: any) {
      console.error("Error fetching listing audit trail:", error);
      res.status(500).json({ message: "Failed to fetch listing audit trail" });
    }
  });

  // ===========================================================================
  // DEVELOPER PORTAL ROUTES
  // ===========================================================================

  function requireDeveloper(req: any, res: any, next: any) {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Authentication required" });
    if ((req.user as any).role !== "developer") return res.status(403).json({ message: "Developer access required" });
    next();
  }

  async function ensureProjectOwnership(req: any, res: any, propertyId: number) {
    const property = await storage.getProperty(propertyId);
    if (!property) {
      res.status(404).json({ message: "Project not found" });
      return null;
    }
    if (property.developerId !== (req.user as any).id) {
      res.status(403).json({ message: "Not your project" });
      return null;
    }
    return property;
  }

  // Developer registration
  app.post("/api/developer/register", async (req, res) => {
    try {
      const { developerRegisterSchema } = await import("@shared/schema");
      const result = developerRegisterSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid registration data", details: result.error.errors });
      }
      const { email, password, firstName, lastName, phone, companyName, companyRegistration, websiteUrl } = result.data;

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ message: "An account already exists with this email" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        role: "developer",
        accountStatus: "approved",
        emailVerified: true,
        companyName,
        companyRegistration: companyRegistration || null,
        websiteUrl: websiteUrl || null,
      } as any);

      try {
        await sendEmail({
          to: "info@brikvest.net",
          subject: `New Developer Signup — ${companyName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a365d;">New Developer Signed Up</h2>
              <p><strong>Company:</strong> ${companyName}</p>
              <p><strong>Contact:</strong> ${firstName} ${lastName} (${email})</p>
              <p><strong>Phone:</strong> ${phone}</p>
              ${websiteUrl ? `<p><strong>Website:</strong> ${websiteUrl}</p>` : ""}
            </div>
          `,
        });
      } catch (e) { console.error("Failed to send developer signup notification:", e); }

      const { password: _pw, ...safe } = user as any;
      req.login(user, (err) => {
        if (err) return res.status(201).json({ ...safe, message: "Account created. Please log in." });
        res.status(201).json({ ...safe, message: "Welcome to Brikvest Developer Portal!" });
      });
    } catch (err: any) {
      console.error("Developer registration error:", err);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Developer login (uses same passport local strategy via /api/login). Provide an alias.
  app.post("/api/developer/login", passport.authenticate("local"), (req, res) => {
    const user = req.user as any;
    if (user.role !== "developer") {
      req.logout(() => res.status(403).json({ message: "Not a developer account. Please use the regular sign-in." }));
      return;
    }
    const { password: _pw, ...safe } = user;
    res.json(safe);
  });

  // Get current developer profile
  app.get("/api/developer/me", requireDeveloper, (req, res) => {
    const { password: _pw, ...safe } = req.user as any;
    res.json(safe);
  });

  // Update developer profile
  app.patch("/api/developer/me", requireDeveloper, async (req: any, res) => {
    try {
      const { firstName, lastName, phone, companyName, companyRegistration, websiteUrl } = req.body || {};
      const updated = await storage.updateUser(req.user.id, {
        firstName: typeof firstName === "string" ? firstName.slice(0, 100) : undefined,
        lastName: typeof lastName === "string" ? lastName.slice(0, 100) : undefined,
        phone: typeof phone === "string" ? phone.slice(0, 30) : undefined,
        companyName: typeof companyName === "string" ? companyName.slice(0, 200) : undefined,
        companyRegistration: typeof companyRegistration === "string" ? companyRegistration.slice(0, 100) : undefined,
        websiteUrl: typeof websiteUrl === "string" ? websiteUrl.slice(0, 500) : undefined,
      } as any);
      const { password: _pw, ...safe } = updated as any;
      res.json(safe);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // List developer's own projects
  app.get("/api/developer/projects", requireDeveloper, async (req: any, res) => {
    try {
      const projects = await storage.getPropertiesByDeveloper(req.user.id);

      // Compute per-project rollup stats
      const enriched = await Promise.all(projects.map(async (p) => {
        const reservations = await storage.getReservationsByProperty(p.id);
        const confirmed = reservations.filter(r => r.status === "converted_to_investment");
        const milestones = await storage.getMilestonesByProperty(p.id);
        const overallProgress = milestones.length === 0 ? 0 : Math.round(milestones.reduce((sum, m) => sum + (m.percentComplete || 0), 0) / milestones.length);
        const nextMilestone = milestones.find(m => m.status !== "done");
        const totalUnits = p.totalUnits || 0;
        const soldUnits = Number(p.soldUnits || 0);
        const investorUnits = confirmed.reduce((s, r) => s + Number(r.units || 0), 0);
        const unitPrice = Number(p.unitPrice || 0);
        const totalRaised = confirmed.reduce(
          (s, r) => s + (Number(r.amount) || (Number(r.units || 0) * unitPrice)),
          0,
        );

        return {
          ...p,
          investorCount: confirmed.length,
          fundingPercent: totalUnits > 0 ? Math.round((investorUnits / totalUnits) * 100) : 0,
          salesPercent: totalUnits > 0 ? Math.round((soldUnits / totalUnits) * 100) : 0,
          constructionPercent: overallProgress,
          nextMilestoneDate: nextMilestone?.targetDate || null,
          nextMilestoneName: nextMilestone?.name || null,
          totalRaised,
        };
      }));

      res.json(enriched);
    } catch (err) {
      console.error("Failed to list developer projects:", err);
      res.status(500).json({ message: "Failed to list projects" });
    }
  });

  // Create a new project (starts as draft)
  app.post("/api/developer/projects", requireDeveloper, async (req: any, res) => {
    try {
      const body = req.body || {};
      const required = ["name", "location", "description", "totalValue", "totalUnits", "unitPrice", "imageUrl"];
      for (const k of required) {
        if (body[k] === undefined || body[k] === null || body[k] === "") {
          return res.status(400).json({ message: `Field '${k}' is required` });
        }
      }
      const totalUnits = Number(body.totalUnits) || 0;
      const developerEquityUnits = Number(body.developerEquityUnits) || 0;
      if (developerEquityUnits > totalUnits) {
        return res.status(400).json({ message: "Developer-retained units cannot exceed total units" });
      }
      const property = await storage.createProperty({
        name: body.name,
        location: body.location,
        description: body.description,
        totalValue: Number(body.totalValue),
        minInvestment: Number(body.minInvestment ?? body.unitPrice),
        availableSlots: totalUnits,
        totalSlots: totalUnits,
        fundingProgress: 0,
        imageUrl: body.imageUrl,
        videoUrl: body.videoUrl || null,
        gallery: Array.isArray(body.gallery) ? body.gallery : [],
        status: "active",
        propertyType: body.propertyType || "land",
        currency: body.currency || "NGN",
        totalUnits,
        reservedUnits: 0,
        soldUnits: 0,
        unitPrice: Number(body.unitPrice),
        unitPrecision: body.unitPrecision || "1.00",
        isTransferable: !!body.isTransferable,
        spvName: body.spvName || null,
        city: body.city || null,
        district: body.district || null,
        developerNotes: body.developerNotes || null,
        investmentDetails: body.investmentDetails || null,
        developerId: req.user.id,
        developerEquityUnits: String(developerEquityUnits),
        projectStatus: "draft",
      } as any);
      res.status(201).json(property);
    } catch (err: any) {
      console.error("Failed to create developer project:", err);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  // Get single project (developer-owned only)
  app.get("/api/developer/projects/:id", requireDeveloper, async (req: any, res) => {
    const propertyId = parseInt(req.params.id);
    const property = await ensureProjectOwnership(req, res, propertyId);
    if (!property) return;
    res.json(property);
  });

  // Update project
  app.patch("/api/developer/projects/:id", requireDeveloper, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await ensureProjectOwnership(req, res, propertyId);
      if (!property) return;
      const updates = { ...req.body };
      // Whitelist editable fields
      const allowed = [
        "name", "location", "description", "totalValue", "minInvestment", "imageUrl", "videoUrl", "gallery",
        "propertyType", "currency", "city", "district", "spvName", "developerNotes", "investmentDetails",
        "isTransferable", "unitPrice", "unitPrecision", "developerEquityUnits",
        // Construction project-level fields
        "currentStage", "expectedCompletionDate", "risksDelays", "latestUpdateText",
      ];
      const payload: any = {};
      for (const k of allowed) {
        if (updates[k] !== undefined) {
          // Coerce date strings to Date objects (Drizzle requires Date for timestamp columns)
          if (k === "expectedCompletionDate" && updates[k]) {
            payload[k] = new Date(updates[k]);
          } else {
            payload[k] = updates[k];
          }
        }
      }

      // Only allow editing developerEquityUnits if no confirmed investments
      if (payload.developerEquityUnits !== undefined) {
        const reservations = await storage.getReservationsByProperty(propertyId);
        const hasConfirmed = reservations.some(r => r.status === "converted_to_investment");
        if (hasConfirmed) delete payload.developerEquityUnits;
        else payload.developerEquityUnits = String(payload.developerEquityUnits);
      }
      // Don't allow editing totalUnits if any reservations exist
      if (updates.totalUnits !== undefined) {
        const reservations = await storage.getReservationsByProperty(propertyId);
        if (reservations.length === 0) {
          payload.totalUnits = Number(updates.totalUnits);
          payload.availableSlots = Number(updates.totalUnits);
          payload.totalSlots = Number(updates.totalUnits);
        }
      }
      const updated = await storage.updateProperty(propertyId, { ...property, ...payload } as any);
      res.json(updated);
    } catch (err) {
      console.error("Failed to update project:", err);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  // Submit project for admin approval
  app.post("/api/developer/projects/:id/submit", requireDeveloper, async (req: any, res) => {
    const propertyId = parseInt(req.params.id);
    const property = await ensureProjectOwnership(req, res, propertyId);
    if (!property) return;
    if (property.projectStatus !== "draft") return res.status(400).json({ message: "Only draft projects can be submitted" });
    const updated = await storage.updateProperty(propertyId, { ...property, projectStatus: "pending_approval" } as any);
    try {
      await sendEmail({
        to: "info@brikvest.net",
        subject: `Project Pending Approval — ${property.name}`,
        html: `<p>Developer ${(req.user as any).companyName || (req.user as any).email} submitted project <strong>${property.name}</strong> for approval.</p>`,
      });
    } catch (e) { console.error(e); }
    res.json(updated);
  });

  // Per-project rollup
  app.get("/api/developer/projects/:id/rollup", requireDeveloper, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await ensureProjectOwnership(req, res, propertyId);
      if (!property) return;
      const reservations = await storage.getReservationsByProperty(propertyId);
      const milestones = await storage.getMilestonesByProperty(propertyId);
      const updates = await storage.getProjectUpdatesByProperty(propertyId);

      const confirmed = reservations.filter(r => r.status === "converted_to_investment");
      const reserved = reservations.filter(r => r.status === "reserved");
      const totalUnits = Number(property.totalUnits || 0);
      const developerEquityUnits = Number(property.developerEquityUnits || 0);
      const investorUnits = confirmed.reduce((s, r) => s + Number(r.units || 0), 0);
      const reservedUnits = reserved.reduce((s, r) => s + Number(r.units || 0), 0);
      const availableUnits = Math.max(0, totalUnits - investorUnits - reservedUnits - developerEquityUnits);

      const totalRaised = confirmed.reduce((s, r) => s + Number(r.amount || 0), 0);
      const fundingTarget = (totalUnits - developerEquityUnits) * Number(property.unitPrice || 0);

      // Funnel
      const reservedCount = reservations.length;
      const reservationsWithUsers = await Promise.all(reservations.map(async r => {
        const user = r.userId ? await storage.getUser(r.userId) : null;
        const submissions = await storage.getPaymentSubmissionsByReservationId(r.id);
        return { ...r, user, hasPayment: submissions.length > 0 };
      }));
      const kycComplete = reservationsWithUsers.filter(r => r.user?.kycStatus === "approved").length;
      const paymentSubmitted = reservationsWithUsers.filter(r => r.hasPayment).length;
      const confirmedCount = confirmed.length;

      // Construction
      const overallConstruction = milestones.length === 0
        ? 0
        : Math.round(milestones.reduce((s, m) => s + (m.percentComplete || 0), 0) / milestones.length);
      const nextMilestone = milestones.find(m => m.status !== "done");

      // Sales velocity (units per week, last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentSales = confirmed.filter(r => r.createdAt && new Date(r.createdAt as any) >= thirtyDaysAgo);
      const velocity30 = recentSales.reduce((s, r) => s + Number(r.units || 0), 0) / 4.3;

      res.json({
        funding: { totalRaised, fundingTarget, currency: property.currency, percent: fundingTarget > 0 ? Math.round((totalRaised / fundingTarget) * 100) : 0 },
        sales: { totalUnits, investorUnits, reservedUnits, developerEquityUnits, availableUnits, velocityPerWeek: Math.round(velocity30 * 100) / 100 },
        funnel: { reserved: reservedCount, kycComplete, paymentSubmitted, confirmed: confirmedCount },
        construction: { overall: overallConstruction, milestoneCount: milestones.length, nextMilestone },
        capTable: {
          investorEquityPercent: totalUnits > 0 ? Math.round((investorUnits / totalUnits) * 100) : 0,
          developerEquityPercent: totalUnits > 0 ? Math.round((developerEquityUnits / totalUnits) * 100) : 0,
          availableEquityPercent: totalUnits > 0 ? Math.round((availableUnits / totalUnits) * 100) : 0,
          shareholderCount: confirmedCount,
        },
        updateCount: updates.length,
      });
    } catch (err) {
      console.error("Project rollup failed:", err);
      res.status(500).json({ message: "Failed to compute rollup" });
    }
  });

  // Investor list per project (with developer notes)
  app.get("/api/developer/projects/:id/investors", requireDeveloper, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await ensureProjectOwnership(req, res, propertyId);
      if (!property) return;
      const reservations = await storage.getReservationsByProperty(propertyId);
      const enriched = await Promise.all(reservations.map(async r => {
        const user = r.userId ? await storage.getUser(r.userId) : null;
        const submissions = await storage.getPaymentSubmissionsByReservationId(r.id);
        const note = user
          ? await storage.getDeveloperInvestorNote(propertyId, req.user.id, user.id)
          : null;
        // Sort newest-first for the drill-down timeline.
        const sortedPayments = [...submissions].sort((a: any, b: any) => {
          const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
          const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
          return tb - ta;
        });
        return {
          reservationId: r.id,
          investorUserId: user?.id || null,
          name: r.fullName,
          email: r.email,
          phone: r.phone,
          country: user?.country || null,
          units: r.units,
          amount: r.amount,
          currency: r.currency,
          status: r.status,
          kycStatus: user?.kycStatus || "not_started",
          hasPayment: submissions.length > 0,
          paymentStatus: sortedPayments[0]?.status || null,
          paymentHistory: sortedPayments.map((p: any) => ({
            id: p.id,
            status: p.status,
            amount: p.amount,
            currency: p.currency,
            paymentMethod: p.paymentMethod,
            transactionRef: p.transactionRef || p.transactionReference || null,
            submittedAt: p.submittedAt || p.createdAt || null,
            reviewedAt: p.reviewedAt || null,
            rejectionReason: p.rejectionReason || null,
          })),
          createdAt: r.createdAt,
          confirmedAt: r.status === "converted_to_investment" ? r.updatedAt : null,
          notes: note?.notes || "",
        };
      }));
      res.json(enriched);
    } catch (err) {
      console.error("Failed to fetch investors:", err);
      res.status(500).json({ message: "Failed to fetch investors" });
    }
  });

  // Save / update note on a particular investor in a project
  app.post("/api/developer/projects/:id/notes", requireDeveloper, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await ensureProjectOwnership(req, res, propertyId);
      if (!property) return;
      const { investorUserId, notes } = req.body || {};
      if (!investorUserId) return res.status(400).json({ message: "investorUserId is required" });
      const { sanitizeRichText } = await import("./sanitize");
      const note = await storage.upsertDeveloperInvestorNote({
        propertyId,
        developerUserId: req.user.id,
        investorUserId: Number(investorUserId),
        notes: sanitizeRichText(notes || ""),
      });
      res.json(note);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to save note" });
    }
  });

  // CSV export of investors
  app.get("/api/developer/projects/:id/investors.csv", requireDeveloper, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await ensureProjectOwnership(req, res, propertyId);
      if (!property) return;
      const reservations = await storage.getReservationsByProperty(propertyId);
      const rows = [["Name", "Email", "Phone", "Units", "Amount", "Currency", "Status", "KYC", "Joined"]];
      for (const r of reservations) {
        const user = r.userId ? await storage.getUser(r.userId) : null;
        rows.push([
          r.fullName,
          r.email,
          r.phone,
          String(r.units),
          String(r.amount),
          r.currency || "",
          r.status,
          user?.kycStatus || "n/a",
          r.createdAt ? new Date(r.createdAt as any).toISOString() : "",
        ]);
      }
      const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${property.name.replace(/[^a-z0-9]/gi, "_")}_investors.csv"`);
      res.send(csv);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to export CSV" });
    }
  });

  // Milestones — list
  app.get("/api/developer/projects/:id/milestones", requireDeveloper, async (req: any, res) => {
    const propertyId = parseInt(req.params.id);
    const property = await ensureProjectOwnership(req, res, propertyId);
    if (!property) return;
    const milestones = await storage.getMilestonesByProperty(propertyId);
    res.json(milestones);
  });

  // Milestones — create
  app.post("/api/developer/projects/:id/milestones", requireDeveloper, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await ensureProjectOwnership(req, res, propertyId);
      if (!property) return;
      const existing = await storage.getMilestonesByProperty(propertyId);
      const sortOrder = req.body.sortOrder ?? (existing.length > 0 ? Math.max(...existing.map(m => m.sortOrder || 0)) + 1 : 0);
      const milestone = await storage.createProjectMilestone({
        propertyId,
        name: req.body.name,
        description: req.body.description || null,
        targetDate: req.body.targetDate ? new Date(req.body.targetDate) : null,
        completedDate: req.body.completedDate ? new Date(req.body.completedDate) : null,
        status: req.body.status || "not_started",
        percentComplete: Number(req.body.percentComplete || 0),
        mediaUrls: Array.isArray(req.body.mediaUrls) ? req.body.mediaUrls : [],
        notes: req.body.notes || null,
        sortOrder,
      } as any);
      res.status(201).json(milestone);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create milestone" });
    }
  });

  // Milestones — update
  app.patch("/api/developer/milestones/:milestoneId", requireDeveloper, async (req: any, res) => {
    try {
      const milestone = await storage.getMilestone(parseInt(req.params.milestoneId));
      if (!milestone) return res.status(404).json({ message: "Milestone not found" });
      const property = await ensureProjectOwnership(req, res, milestone.propertyId);
      if (!property) return;
      const updates: any = { ...req.body };
      if (updates.targetDate) updates.targetDate = new Date(updates.targetDate);
      if (updates.completedDate) updates.completedDate = new Date(updates.completedDate);
      if (updates.percentComplete !== undefined) updates.percentComplete = Number(updates.percentComplete);
      const updated = await storage.updateMilestone(milestone.id, updates);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update milestone" });
    }
  });

  // Milestones — delete
  app.delete("/api/developer/milestones/:milestoneId", requireDeveloper, async (req: any, res) => {
    try {
      const milestone = await storage.getMilestone(parseInt(req.params.milestoneId));
      if (!milestone) return res.status(404).json({ message: "Milestone not found" });
      const property = await ensureProjectOwnership(req, res, milestone.propertyId);
      if (!property) return;
      await storage.deleteMilestone(milestone.id);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete milestone" });
    }
  });

  // Project updates — list
  app.get("/api/developer/projects/:id/updates", requireDeveloper, async (req: any, res) => {
    const propertyId = parseInt(req.params.id);
    const property = await ensureProjectOwnership(req, res, propertyId);
    if (!property) return;
    res.json(await storage.getProjectUpdatesByProperty(propertyId));
  });

  // Project updates — list all by developer (cross-project history)
  app.get("/api/developer/updates", requireDeveloper, async (req: any, res) => {
    const updates = await storage.getProjectUpdatesByDeveloper(req.user.id);
    // Enrich with property names
    const enriched = await Promise.all(updates.map(async u => {
      const property = await storage.getProperty(u.propertyId);
      return { ...u, propertyName: property?.name || `Project #${u.propertyId}` };
    }));
    res.json(enriched);
  });

  // Project updates — create + broadcast
  app.post("/api/developer/projects/:id/updates", requireDeveloper, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await ensureProjectOwnership(req, res, propertyId);
      if (!property) return;
      const { type, subject, body, mediaUrls } = req.body || {};
      if (!subject || !body) return res.status(400).json({ message: "Subject and body are required" });

      // Find confirmed investors
      const reservations = await storage.getReservationsByProperty(propertyId);
      const confirmed = reservations.filter(r => r.status === "converted_to_investment");
      // Dedupe by email
      const recipients: { email: string; name: string }[] = [];
      const seen = new Set<string>();
      for (const r of confirmed) {
        if (!r.email || seen.has(r.email)) continue;
        seen.add(r.email);
        recipients.push({ email: r.email, name: r.fullName });
      }

      const { sanitizeRichText } = await import("./sanitize");
      const safeBody = sanitizeRichText(body);
      const safeSubject = String(subject).slice(0, 200);
      const update = await storage.createProjectUpdate({
        propertyId,
        authorUserId: req.user.id,
        type: type || "general",
        subject: safeSubject,
        body: safeBody,
        mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
      } as any, recipients.length);

      // Send emails (failures isolated per investor)
      const { sendProjectUpdateToInvestor } = await import("./projectUpdateEmails");
      const developerCompany = (req.user as any).companyName || `${(req.user as any).firstName || ""} ${(req.user as any).lastName || ""}`.trim() || "Your Developer";
      const safeMediaUrls = Array.isArray(mediaUrls) ? mediaUrls.filter((m: any) => typeof m === "string") : [];
      const firstImage = safeMediaUrls.find((m: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(m)) || null;
      for (const r of recipients) {
        try {
          await sendProjectUpdateToInvestor({
            investorEmail: r.email,
            investorName: r.name,
            propertyName: property.name,
            developerCompany,
            type: type || "general",
            subject: safeSubject,
            body: safeBody,
            imageUrl: firstImage,
            mediaUrls: safeMediaUrls,
          });
        } catch (e) {
          console.error(`Failed to send update to ${r.email}:`, e);
        }
      }

      res.status(201).json(update);
    } catch (err) {
      console.error("Failed to broadcast project update:", err);
      res.status(500).json({ message: "Failed to publish update" });
    }
  });

  // Investor-facing: get updates for properties the user has confirmed investments in
  app.get("/api/user/project-updates", requireAuth, async (req: any, res) => {
    try {
      const reservations = await storage.getReservationsByUserId(req.user.id);
      const propertyIds = Array.from(new Set(reservations
        .filter(r => r.status === "converted_to_investment")
        .map(r => r.propertyId)));
      const result: Record<number, any[]> = {};
      for (const pid of propertyIds) {
        result[pid] = await storage.getProjectUpdatesByProperty(pid);
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch project updates" });
    }
  });

  // Investor-facing: get milestones for a property the user has invested in
  app.get("/api/user/property/:id/milestones", requireAuth, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const reservations = await storage.getReservationsByUserId(req.user.id);
      const hasAccess = reservations.some(r => r.propertyId === propertyId && r.status === "converted_to_investment");
      if (!hasAccess) return res.status(403).json({ message: "Not an investor in this property" });
      res.json(await storage.getMilestonesByProperty(propertyId));
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch milestones" });
    }
  });

  // Admin: list all developer-managed projects
  app.get("/api/admin/developer-projects", requireAdminAuth, async (req, res) => {
    try {
      const developers = await storage.getDevelopers();
      const result = [];
      for (const dev of developers) {
        const projects = await storage.getPropertiesByDeveloper(dev.id);
        result.push({
          developer: { id: dev.id, email: dev.email, companyName: dev.companyName, firstName: dev.firstName, lastName: dev.lastName, phone: dev.phone, websiteUrl: dev.websiteUrl, createdAt: dev.createdAt },
          projects,
        });
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to list developer projects" });
    }
  });

  // Admin: take over a developer's project (clears developerId so it becomes admin-managed)
  app.post("/api/admin/developer-projects/:id/take-over", requireAdminAuth, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      if (!property) return res.status(404).json({ message: "Project not found" });
      const previousDeveloperId = property.developerId;
      const updated = await storage.updateProperty(propertyId, { ...property, developerId: null, projectStatus: "live" } as any);
      // Notify former developer
      try {
        if (previousDeveloperId) {
          const developer = await storage.getUser(previousDeveloperId);
          if (developer) {
            await sendEmail({
              to: developer.email,
              subject: `Brikvest has taken over management of ${property.name}`,
              html: `<p>Brikvest admin has taken over administrative management of your project <strong>${property.name}</strong>. The project remains live for investors. Please contact support if you have any questions.</p>`,
            });
          }
        }
      } catch (e) { console.error(e); }
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to take over project" });
    }
  });

  // Admin: review (approve/reject) a developer's draft project
  app.post("/api/admin/developer-projects/:id/review", requireAdminAuth, async (req: any, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const action = req.body.action; // 'approve' | 'reject' | 'archive' | 'unarchive'
      const property = await storage.getProperty(propertyId);
      if (!property) return res.status(404).json({ message: "Project not found" });

      // Enforce explicit state-machine: draft -> pending_approval -> live -> (sold_out|archived)
      // Admin-only paths: approve (pending_approval -> live), reject (pending_approval -> draft),
      // archive (live|sold_out -> archived), unarchive (archived -> draft).
      const current = property.projectStatus || "draft";
      let newStatus = current;
      const ALLOWED: Record<string, string[]> = {
        approve:   ["pending_approval"],
        reject:    ["pending_approval"],
        archive:   ["live", "sold_out"],
        unarchive: ["archived"],
      };
      const allowedFrom = ALLOWED[action];
      if (!allowedFrom) {
        return res.status(400).json({ message: "Invalid action" });
      }
      if (!allowedFrom.includes(current)) {
        return res.status(409).json({
          message: `Cannot ${action} a project that is currently "${current}". Allowed previous status: ${allowedFrom.join(", ")}.`,
          currentStatus: current,
          allowedFrom,
        });
      }
      if      (action === "approve")   newStatus = "live";
      else if (action === "reject")    newStatus = "draft";
      else if (action === "archive")   newStatus = "archived";
      else if (action === "unarchive") newStatus = "draft";
      const updated = await storage.updateProperty(propertyId, { ...property, projectStatus: newStatus } as any);

      // Notify developer
      try {
        if (property.developerId) {
          const developer = await storage.getUser(property.developerId);
          if (developer) {
            await sendEmail({
              to: developer.email,
              subject: `Project ${action === "approve" ? "Approved" : action === "reject" ? "Sent back to draft" : "Archived"} — ${property.name}`,
              html: `<p>Your project <strong>${property.name}</strong> was ${action}d by Brikvest admin.</p>`,
            });
          }
        }
      } catch (e) { console.error(e); }

      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to review project" });
    }
  });

  // Run initial cleanup of expired reservations on startup
  storage.cleanupExpiredReservations()
    .then(result => {
      if (result.cancelled > 0) {
        console.log(`[STARTUP] Cleaned up ${result.cancelled} expired reservation(s), released ${result.unitsReleased} units`);
      }
    })
    .catch(err => console.error('[STARTUP] Failed to cleanup expired reservations:', err));
  
  // Schedule cleanup every hour
  setInterval(() => {
    storage.cleanupExpiredReservations()
      .then(result => {
        if (result.cancelled > 0) {
          console.log(`[SCHEDULED] Cleaned up ${result.cancelled} expired reservation(s), released ${result.unitsReleased} units`);
        }
      })
      .catch(err => console.error('[SCHEDULED] Failed to cleanup expired reservations:', err));
  }, 60 * 60 * 1000); // Every hour

  // Auto-process expired resale payment deadlines every 30 minutes
  async function processExpiredResalePayments() {
    try {
      const expiredListings = await storage.getExpiredAwaitingPaymentListings();
      for (const listing of expiredListings) {
        if (!listing.winnerId) continue;

        console.log(`[RESALE-EXPIRY] Processing expired payment for listing #${listing.id}`);

        // Mark winner's bid as failed
        if (listing.highestBidId) {
          const winnerBid = await storage.getResaleBid(listing.highestBidId);
          if (winnerBid && winnerBid.bidderId === listing.winnerId) {
            await storage.updateResaleBid(winnerBid.id, { status: "failed_payment", failureReason: "Payment deadline expired (auto)" });
          }
        }

        // Reject pending payments
        const payments = await storage.getResalePaymentsByListing(listing.id);
        for (const p of payments) {
          if (p.status === "pending_verification") {
            await storage.updateResalePayment(p.id, {
              status: "rejected",
              rejectionReason: "Payment deadline expired (auto-processed)",
              reviewedAt: new Date(),
            });
          }
        }

        const result = await handleNextBidderFallback(listing, listing.winnerId, "Payment deadline expired");
        console.log(`[RESALE-EXPIRY] Listing #${listing.id}: ${result}`);
      }
      if (expiredListings.length > 0) {
        console.log(`[RESALE-EXPIRY] Processed ${expiredListings.length} expired listing(s)`);
      }
    } catch (err) {
      console.error('[RESALE-EXPIRY] Failed to process expired payments:', err);
    }
  }

  processExpiredResalePayments();
  setInterval(processExpiredResalePayments, 30 * 60 * 1000); // Every 30 minutes
  
  return httpServer;
}
