import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { upload, uploadToCloudinary } from "./cloudinary";
import { 
  insertInvestmentReservationSchema, 
  insertDeveloperBidSchema,
  insertPropertySchema,
  loginSchema,
  type Property,
  type InvestmentReservation,
  type DeveloperBid 
} from "@shared/schema";

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

export async function registerRoutes(app: Express): Promise<Server> {
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
      const user = await storage.getUserByUsername(username);

      if (!user || user.password !== password || !user.isActive) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Update last login
      await storage.updateUserLastLogin(user.id);

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

  // Get property by ID
  app.get("/api/properties/:id", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
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
      
      // Check if property exists
      const property = await storage.getProperty(validatedData.propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Check if there are available slots
      if (property.availableSlots < validatedData.units) {
        return res.status(400).json({ message: "Not enough available slots" });
      }

      const reservation = await storage.createInvestmentReservation(validatedData);
      
      // Update property available slots
      await storage.updatePropertySlots(validatedData.propertyId, validatedData.units);
      
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

  // Create developer bid
  app.post("/api/developer-bids", async (req, res) => {
    try {
      const validatedData = insertDeveloperBidSchema.parse(req.body);
      const bid = await storage.createDeveloperBid(validatedData);
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

  const httpServer = createServer(app);
  return httpServer;
}
