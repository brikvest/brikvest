import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertInvestmentReservationSchema, 
  insertDeveloperBidSchema,
  insertPropertySchema,
  type Property,
  type InvestmentReservation,
  type DeveloperBid 
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
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

  // Create new property
  app.post("/api/properties", async (req, res) => {
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

  const httpServer = createServer(app);
  return httpServer;
}
