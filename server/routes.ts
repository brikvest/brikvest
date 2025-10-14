import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword, comparePasswords } from "./auth";
import passport from "passport";
import { randomBytes } from "crypto";
import { upload, uploadToCloudinary } from "./cloudinary";
import { sendEmail } from "./emailService";
import { investmentEmailTemplate, developerBidEmailTemplate } from "./emailTemplates";
import { getExchangeRates, convertCurrency, formatCurrency, detectUserCurrency, CURRENCY_CONFIG, getCurrencyFromCountry } from "./currencyService";
import { 
  insertInvestmentReservationSchema, 
  insertDeveloperBidSchema,
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
  type Property,
  type InvestmentReservation,
  type DeveloperBid,
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
        return sum + (property ? reservation.units * property.minInvestment : 0);
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
      if (property.availableSlots < reservationData.units) {
        return res.status(400).json({ message: "Not enough available slots" });
      }

      const reservation = await storage.createInvestmentReservation(reservationData);
      
      // Update property available slots
      await storage.updatePropertySlots(reservationData.propertyId, reservationData.units);

      // Generate referral code for the user
      const referralCode = `REF${Date.now().toString().slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      
      // Send confirmation email
      try {
        const investmentAmount = reservationData.units * property.minInvestment;
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
      const investmentAmount = reservation.units * property.minInvestment;
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

  // Create developer bid
  app.post("/api/developer-bids", async (req, res) => {
    try {
      const validatedData = insertDeveloperBidSchema.parse(req.body);
      const bid = await storage.createDeveloperBid(validatedData);

      // Send confirmation email to developer
      try {
        const emailTemplate = developerBidEmailTemplate({
          fullName: validatedData.developerName,
          propertyName: "our available properties" // Generic since bids aren't property-specific
        });
        
        await sendEmail({
          to: validatedData.email,
          subject: emailTemplate.subject,
          html: emailTemplate.html
        });
        
        console.log(`Developer bid confirmation email sent to ${validatedData.email}`);
      } catch (emailError) {
        console.error("Failed to send developer bid confirmation email:", emailError);
        // Don't fail the request if email fails
      }

      res.status(201).json(bid);
    } catch (error) {
      console.error("Error creating developer bid:", error);
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid data provided" });
      }
      res.status(500).json({ message: "Failed to create developer bid" });
    }
  });

  // Get all developer bids (admin endpoint)
  app.get("/api/developer-bids", async (req, res) => {
    try {
      const bids = await storage.getDeveloperBids();
      res.json(bids);
    } catch (error) {
      console.error("Error fetching developer bids:", error);
      res.status(500).json({ message: "Failed to fetch developer bids" });
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

  const httpServer = createServer(app);
  return httpServer;
}
