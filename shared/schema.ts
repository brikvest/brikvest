import { pgTable, text, serial, integer, boolean, timestamp, decimal, bigint, varchar, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table for email/password authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email").unique().notNull(),
  password: text("password").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  phone: text("phone"),
  referralCode: text("referral_code"),
  role: text("role").notNull().default("user"), // 'user', 'admin', 'super_admin', 'investor'
  accountStatus: text("account_status").notNull().default("pending"), // 'pending', 'approved', 'rejected'
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: boolean("email_verified").notNull().default(false),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  lastLogin: timestamp("last_login"),
  country: varchar("country", { length: 2 }), // ISO country code
  preferredCurrency: varchar("preferred_currency", { length: 3 }).default("USD"), // ISO currency code
  
  // KYC (Know Your Customer) verification fields
  kycStatus: text("kyc_status").notNull().default("not_started"), // 'not_started', 'submitted', 'approved', 'rejected'
  kycFullName: text("kyc_full_name"), // Full legal name from government ID
  kycDateOfBirth: timestamp("kyc_date_of_birth"), // Must be 18+ years old
  kycAddress: text("kyc_address"), // Residential address
  kycOccupation: text("kyc_occupation"), // User's occupation/profession
  kycIdType: text("kyc_id_type"), // 'passport', 'drivers_license', 'national_id'
  kycIdNumber: text("kyc_id_number"), // ID number
  kycIdDocumentUrl: text("kyc_id_document_url"), // Cloudinary URL for ID document
  kycSelfieUrl: text("kyc_selfie_url"), // Optional selfie/liveness check
  kycSignatureUrl: text("kyc_signature_url"), // Cloudinary URL for user's signature
  kycSubmittedAt: timestamp("kyc_submitted_at"), // When KYC was submitted
  kycVerifiedAt: timestamp("kyc_verified_at"), // When KYC was verified by admin
  kycRejectionReason: text("kyc_rejection_reason"), // Reason for KYC rejection if rejected
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Keep admin users separate for admin authentication
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull().default("temp_password"),
  email: text("email").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("admin"), // 'admin', 'super_admin'
  isActive: boolean("is_active").notNull().default(true),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  totalValue: bigint("total_value", { mode: "number" }).notNull(),
  minInvestment: bigint("min_investment", { mode: "number" }).notNull(),

  availableSlots: integer("available_slots").notNull(),
  totalSlots: integer("total_slots").notNull(),
  fundingProgress: integer("funding_progress").notNull().default(0),
  imageUrl: text("image_url").notNull(),
  videoUrl: text("video_url"), // Property video URL
  gallery: text("gallery").array(), // Array of gallery image URLs
  status: text("status").notNull().default("active"),
  propertyType: text("property_type").default("land"),
  badge: text("badge"), // e.g., 'partnered', 'verified', etc.
  partnershipDocumentUrl: text("partnership_document_url"), // URL to signed partnership document
  partnershipDocumentName: text("partnership_document_name"), // Display name for document
  developerNotes: text("developer_notes"), // Notes from developer about the project
  investmentDetails: text("investment_details"), // Detailed investment information
  currency: text("currency").notNull().default("NGN"), // Currency for property values (NGN = Nigerian Naira - platform default)
  
  // Unit-based investment tracking
  totalUnits: integer("total_units").notNull().default(0), // Total units available for the property
  reservedUnits: integer("reserved_units").notNull().default(0), // Units soft-locked for payment_pending reservations
  soldUnits: integer("sold_units").notNull().default(0), // Units confirmed and sold
  unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0), // Price per unit
  totalSquareMeters: decimal("total_square_meters", { precision: 12, scale: 2 }), // Total land area in square meters
  unitPrecision: decimal("unit_precision", { precision: 10, scale: 2 }).notNull().default("1.00"), // Minimum step for unit selection (e.g., 0.1, 0.5, 1)
  
  valuationReportUrl: text("valuation_report_url"),
  valuationReportName: text("valuation_report_name"),
  
  // SPV (Special Purpose Vehicle) identification
  spvName: text("spv_name"),
  city: text("city"), // City for SPV generation (e.g., Abuja, Lagos)
  district: text("district"), // District/area for SPV generation (e.g., Guzape, Lekki)
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const investmentReservations = pgTable("investment_reservations", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  userId: integer("user_id").references(() => users.id), // Link to authenticated user
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  units: decimal("units", { precision: 15, scale: 2 }).notNull(), // Number of units being purchased
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(), // Total amount (units * unitPriceSnapshot)
  currency: text("currency").notNull().default("NGN"), // Currency for the investment (NGN = Nigerian Naira - platform default)
  unitPriceSnapshot: decimal("unit_price_snapshot", { precision: 15, scale: 2 }).notNull(), // Price per unit at time of reservation
  referralCode: text("referral_code"),
  status: text("status").notNull().default("reserved"), // 'reserved', 'expired', 'converted_to_investment', 'cancelled'
  
  // Payment tracking (admin-assisted)
  paymentMethod: text("payment_method"), // 'bank_transfer', 'card', 'cash', 'check', etc.
  paymentReference: text("payment_reference"), // Transaction ID or reference number
  paymentEvidenceUrl: text("payment_evidence_url"), // Cloudinary URL for payment receipt/proof
  
  // Admin tracking
  createdByAdminId: integer("created_by_admin_id").references(() => adminUsers.id), // Admin who created this reservation
  notes: text("notes"), // Admin notes about the reservation
  
  // Reservation expiration (24 hours from creation for payment_pending status)
  expiresAt: timestamp("expires_at"), // When the reservation expires if payment not received
  kycExtendedAt: timestamp("kyc_extended_at"), // When the reservation was extended due to KYC submission (one-time +24h extension)
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Payment records for investment reservations (legacy - admin recorded)
export const investmentPayments = pgTable("investment_payments", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().references(() => investmentReservations.id),
  amount: bigint("amount", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("USD"),
  paymentMethod: text("payment_method").notNull(), // 'bank_transfer', 'card', 'cash', 'check', etc.
  paymentReference: text("payment_reference"), // Transaction ID or reference number
  paymentEvidenceUrl: text("payment_evidence_url"), // Cloudinary URL for payment receipt/proof
  recordedByAdminId: integer("recorded_by_admin_id").notNull().references(() => adminUsers.id),
  status: text("status").notNull().default("received"), // 'received', 'verified', 'refunded'
  notes: text("notes"), // Admin notes about the payment
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

// User-submitted payment proofs for admin review
export const paymentSubmissions = pgTable("payment_submissions", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().references(() => investmentReservations.id),
  userId: integer("user_id").notNull().references(() => users.id),
  proofUrl: text("proof_url").notNull(), // Cloudinary/Object Storage URL for payment proof (image/pdf)
  proofType: text("proof_type").notNull().default("image"), // 'image', 'pdf'
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  paymentMethod: text("payment_method").notNull().default("bank_transfer"), // 'bank_transfer', 'card', etc.
  bankReference: text("bank_reference"), // User-provided reference/transaction ID
  status: text("status").notNull().default("pending_admin_review"), // 'pending_admin_review', 'approved', 'rejected'
  rejectionReason: text("rejection_reason"), // Reason for rejection if rejected
  reviewedByAdminId: integer("reviewed_by_admin_id").references(() => adminUsers.id),
  reviewedAt: timestamp("reviewed_at"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const developerBids = pgTable("developer_bids", {
  id: serial("id").primaryKey(),
  developerName: text("developer_name").notNull(),
  companyName: text("company_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  estimatedCost: bigint("estimated_cost", { mode: "number" }).notNull(),
  costCurrency: text("cost_currency").notNull().default("NGN"),
  description: text("description").notNull(),
  timeline: integer("timeline").notNull(),
  pastProjectLink: text("past_project_link"),
  pastProjectFile: text("past_project_file"),
  whySelected: text("why_selected").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const investmentGroups = pgTable("investment_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  creatorEmail: text("creator_email").notNull(),
  targetAmount: bigint("target_amount", { mode: "number" }).notNull(),
  currentAmount: bigint("current_amount", { mode: "number" }).notNull().default(0),
  maxMembers: integer("max_members").notNull().default(10),
  currentMembers: integer("current_members").notNull().default(1),
  propertyId: integer("property_id").references(() => properties.id),
  status: text("status").notNull().default("open"), // 'open', 'closed', 'investing', 'completed'
  inviteCode: text("invite_code").notNull().unique(),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupMemberships = pgTable("group_memberships", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => investmentGroups.id),
  memberEmail: text("member_email").notNull(),
  memberName: text("member_name").notNull(),
  memberPhone: text("member_phone").notNull(),
  contributionAmount: bigint("contribution_amount", { mode: "number" }).notNull(),
  status: text("status").notNull().default("active"), // 'active', 'pending', 'removed'
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

// Verification steps - the 9 types of verification steps
export const verificationSteps = pgTable("verification_steps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Property verification checklists - which steps are enabled for each property
export const propertyVerificationChecklists = pgTable("property_verification_checklists", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  verificationStepId: integer("verification_step_id").notNull().references(() => verificationSteps.id),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Verification step completions - tracks completion status and photos
export const verificationStepCompletions = pgTable("verification_step_completions", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  verificationStepId: integer("verification_step_id").notNull().references(() => verificationSteps.id),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => adminUsers.id),
  proofPhotos: text("proof_photos").array(), // Array of photo URLs
  notes: text("notes"), // Optional notes from admin
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Ownership Certificates - generated when investment is confirmed
export const ownershipCertificates = pgTable("ownership_certificates", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().references(() => investmentReservations.id).unique(),
  certificateNumber: text("certificate_number").notNull().unique(), // e.g., CERT-2024-00001
  verificationToken: text("verification_token").notNull().unique(), // UUID for QR code verification
  ownerName: text("owner_name").notNull(),
  propertyName: text("property_name").notNull(),
  propertyLocation: text("property_location").notNull(),
  spvName: text("spv_name"), // SPV identifier from property (e.g., BRKABJGUZ011025)
  units: decimal("units", { precision: 15, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
  issuedByAdminId: integer("issued_by_admin_id").references(() => adminUsers.id),
});

// Market Insights - scraped property data from external sources
export const marketInsights = pgTable("market_insights", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // e.g., 'propertypro.ng'
  location: text("location").notNull(), // e.g., 'Abuja', 'Lagos'
  propertyTitle: text("property_title").notNull(),
  propertyType: text("property_type"), // e.g., 'Land', 'House', 'Commercial'
  price: bigint("price", { mode: "number" }), // Price in local currency
  pricePerSqm: decimal("price_per_sqm"), // Price per square meter if available
  size: text("size"), // Property size (e.g., "500 sqm", "2 hectares")
  bedrooms: integer("bedrooms"), // For houses/apartments
  bathrooms: integer("bathrooms"), // For houses/apartments
  url: text("url"), // Link to original listing
  imageUrl: text("image_url"), // Main image from listing
  description: text("description"), // Property description
  scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Guzape listings from PropertyPro.ng scraper
export const guzapeListings = pgTable("guzape_listings", {
  id: serial("id").primaryKey(),
  listingId: text("listing_id").notNull().unique(), // Last slug from detail URL
  title: text("title").notNull(),
  priceNgnRaw: text("price_ngn_raw"), // Raw price string with ₦ symbol
  priceNgn: bigint("price_ngn", { mode: "number" }), // Digits only price
  city: text("city").notNull().default("Abuja"),
  area: text("area"), // Neighborhood/area
  beds: integer("beds"),
  baths: integer("baths"),
  toilets: integer("toilets"),
  image: text("image"), // Main listing image
  detailUrl: text("detail_url").notNull(), // Absolute URL to property
  scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  reservations: many(investmentReservations),
}));

export const propertiesRelations = relations(properties, ({ many }) => ({
  reservations: many(investmentReservations),
  groups: many(investmentGroups),
  verificationChecklists: many(propertyVerificationChecklists),
  verificationCompletions: many(verificationStepCompletions),
}));

export const investmentReservationsRelations = relations(investmentReservations, ({ one, many }) => ({
  property: one(properties, {
    fields: [investmentReservations.propertyId],
    references: [properties.id],
  }),
  user: one(users, {
    fields: [investmentReservations.userId],
    references: [users.id],
  }),
  createdByAdmin: one(adminUsers, {
    fields: [investmentReservations.createdByAdminId],
    references: [adminUsers.id],
  }),
  payments: many(investmentPayments),
  certificate: one(ownershipCertificates),
}));

export const ownershipCertificatesRelations = relations(ownershipCertificates, ({ one }) => ({
  reservation: one(investmentReservations, {
    fields: [ownershipCertificates.reservationId],
    references: [investmentReservations.id],
  }),
  issuedByAdmin: one(adminUsers, {
    fields: [ownershipCertificates.issuedByAdminId],
    references: [adminUsers.id],
  }),
}));

export const investmentPaymentsRelations = relations(investmentPayments, ({ one }) => ({
  reservation: one(investmentReservations, {
    fields: [investmentPayments.reservationId],
    references: [investmentReservations.id],
  }),
  recordedByAdmin: one(adminUsers, {
    fields: [investmentPayments.recordedByAdminId],
    references: [adminUsers.id],
  }),
}));

export const investmentGroupsRelations = relations(investmentGroups, ({ one, many }) => ({
  property: one(properties, {
    fields: [investmentGroups.propertyId],
    references: [properties.id],
  }),
  memberships: many(groupMemberships),
}));

export const groupMembershipsRelations = relations(groupMemberships, ({ one }) => ({
  group: one(investmentGroups, {
    fields: [groupMemberships.groupId],
    references: [investmentGroups.id],
  }),
}));

export const verificationStepsRelations = relations(verificationSteps, ({ many }) => ({
  checklists: many(propertyVerificationChecklists),
  completions: many(verificationStepCompletions),
}));

export const propertyVerificationChecklistsRelations = relations(propertyVerificationChecklists, ({ one }) => ({
  property: one(properties, {
    fields: [propertyVerificationChecklists.propertyId],
    references: [properties.id],
  }),
  verificationStep: one(verificationSteps, {
    fields: [propertyVerificationChecklists.verificationStepId],
    references: [verificationSteps.id],
  }),
}));

export const verificationStepCompletionsRelations = relations(verificationStepCompletions, ({ one }) => ({
  property: one(properties, {
    fields: [verificationStepCompletions.propertyId],
    references: [properties.id],
  }),
  verificationStep: one(verificationSteps, {
    fields: [verificationStepCompletions.verificationStepId],
    references: [verificationSteps.id],
  }),
  completedByAdmin: one(adminUsers, {
    fields: [verificationStepCompletions.completedBy],
    references: [adminUsers.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLogin: true,
  resetToken: true,
  resetTokenExpiry: true,
});

export const registerUserSchema = insertUserSchema.pick({
  email: true,
  password: true,
  firstName: true,
  lastName: true,
  phone: true,
});

export const loginUserSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Valid email is required"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const kycSubmissionSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  dateOfBirth: z.string().refine((date) => {
    const dob = new Date(date);
    const age = Math.floor((new Date().getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return age >= 18;
  }, "You must be 18 years or older"),
  address: z.string().min(10, "Please provide a complete address"),
  occupation: z.string().min(2, "Occupation must be at least 2 characters"),
  idType: z.enum(['passport', 'drivers_license', 'national_id'], {
    errorMap: () => ({ message: "Please select a valid ID type" })
  }),
  idNumber: z.string().min(5, "ID number must be at least 5 characters"),
});

export const insertAdminUserSchema = createInsertSchema(adminUsers).pick({
  username: true,
  password: true,
  role: true,
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const insertPropertySchema = createInsertSchema(properties).omit({
  id: true,
  createdAt: true,
});

export const insertInvestmentReservationSchema = createInsertSchema(investmentReservations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInvestmentPaymentSchema = createInsertSchema(investmentPayments).omit({
  id: true,
  recordedAt: true,
});

export const insertPaymentSubmissionSchema = createInsertSchema(paymentSubmissions).omit({
  id: true,
  uploadedAt: true,
  createdAt: true,
  reviewedAt: true,
});

export const insertDeveloperBidSchema = createInsertSchema(developerBids).omit({
  id: true,
  createdAt: true,
  status: true,
});

export const insertInvestmentGroupSchema = createInsertSchema(investmentGroups).omit({
  id: true,
  createdAt: true,
  currentAmount: true,
  currentMembers: true,
});

export const insertGroupMembershipSchema = createInsertSchema(groupMemberships).omit({
  id: true,
  joinedAt: true,
  status: true,
});

export const insertVerificationStepSchema = createInsertSchema(verificationSteps).omit({
  id: true,
  createdAt: true,
});

export const insertPropertyVerificationChecklistSchema = createInsertSchema(propertyVerificationChecklists).omit({
  id: true,
  createdAt: true,
});

export const insertVerificationStepCompletionSchema = createInsertSchema(verificationStepCompletions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMarketInsightSchema = createInsertSchema(marketInsights).omit({
  id: true,
  createdAt: true,
  scrapedAt: true,
});

export const insertGuzapeListingSchema = createInsertSchema(guzapeListings).omit({
  id: true,
  createdAt: true,
  scrapedAt: true,
});

export const insertOwnershipCertificateSchema = createInsertSchema(ownershipCertificates).omit({
  id: true,
  issuedAt: true,
});

// Property Valuations - historical valuation records per property
export const propertyValuations = pgTable("property_valuations", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  valuationDate: timestamp("valuation_date").notNull(),
  currentValue: decimal("current_value", { precision: 20, scale: 2 }).notNull(),
  appreciationPercentage: decimal("appreciation_percentage", { precision: 8, scale: 2 }),
  reportUrl: text("report_url"),
  reportName: text("report_name"),
  notes: text("notes"),
  createdByAdminId: integer("created_by_admin_id").references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPropertyValuationSchema = createInsertSchema(propertyValuations).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type RegisterUser = z.infer<typeof registerUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type ForgotPassword = z.infer<typeof forgotPasswordSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;
export type User = typeof users.$inferSelect;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUser = typeof adminUsers.$inferSelect;
export type LoginCredentials = z.infer<typeof loginSchema>;

export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof properties.$inferSelect;

export type InsertInvestmentReservation = z.infer<typeof insertInvestmentReservationSchema>;
export type InvestmentReservation = typeof investmentReservations.$inferSelect;

export type InsertInvestmentPayment = z.infer<typeof insertInvestmentPaymentSchema>;
export type InvestmentPayment = typeof investmentPayments.$inferSelect;

export type InsertPaymentSubmission = z.infer<typeof insertPaymentSubmissionSchema>;
export type PaymentSubmission = typeof paymentSubmissions.$inferSelect;

export type InsertDeveloperBid = z.infer<typeof insertDeveloperBidSchema>;
export type DeveloperBid = typeof developerBids.$inferSelect;

export type InsertInvestmentGroup = z.infer<typeof insertInvestmentGroupSchema>;
export type InvestmentGroup = typeof investmentGroups.$inferSelect;

export type InsertGroupMembership = z.infer<typeof insertGroupMembershipSchema>;
export type GroupMembership = typeof groupMemberships.$inferSelect;

export type InsertVerificationStep = z.infer<typeof insertVerificationStepSchema>;
export type VerificationStep = typeof verificationSteps.$inferSelect;

export type InsertPropertyVerificationChecklist = z.infer<typeof insertPropertyVerificationChecklistSchema>;
export type PropertyVerificationChecklist = typeof propertyVerificationChecklists.$inferSelect;

export type InsertVerificationStepCompletion = z.infer<typeof insertVerificationStepCompletionSchema>;
export type VerificationStepCompletion = typeof verificationStepCompletions.$inferSelect;

export type InsertMarketInsight = z.infer<typeof insertMarketInsightSchema>;
export type MarketInsight = typeof marketInsights.$inferSelect;
export type InsertGuzapeListing = z.infer<typeof insertGuzapeListingSchema>;
export type GuzapeListing = typeof guzapeListings.$inferSelect;

export type InsertOwnershipCertificate = z.infer<typeof insertOwnershipCertificateSchema>;
export type OwnershipCertificate = typeof ownershipCertificates.$inferSelect;

export type InsertPropertyValuation = z.infer<typeof insertPropertyValuationSchema>;
export type PropertyValuation = typeof propertyValuations.$inferSelect;
