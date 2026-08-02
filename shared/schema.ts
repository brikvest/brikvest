import { pgTable, text, serial, integer, boolean, timestamp, decimal, bigint, varchar, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

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
  email: text("email").unique().notNull(),
  password: text("password").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  referralCode: text("referral_code").unique(),
  referredByUserId: integer("referred_by_user_id"),
  profileImageUrl: varchar("profile_image_url"),
  // Developer profile fields (when role = 'developer')
  companyName: text("company_name"),
  companyRegistration: text("company_registration"),
  websiteUrl: text("website_url"),
  companyLogoUrl: text("company_logo_url"), // Company logo shown on store listing
  companyDescription: text("company_description"), // Short paragraph shown to buyers
  // Payout details — buyers pay developers directly (Brikvest never holds funds)
  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  bankAccountNumber: text("bank_account_number"),
  // Developer onboarding / due-diligence pipeline (only meaningful when role = 'developer' and teamRole = 'owner')
  // 'submitted' -> 'due_diligence' -> 'agreement_signed' -> 'live' ; 'rejected' is terminal until re-review
  onboardingStage: text("onboarding_stage").notNull().default("submitted"),
  onboardingRejectionReason: text("onboarding_rejection_reason"),
  // Developer subscription / trial / team fields (only meaningful when role = 'developer')
  plan: text("plan").notNull().default("starter"), // 'starter' | 'growth'
  subscriptionStatus: text("subscription_status").notNull().default("trialing"), // 'trialing' | 'active' | 'expired' | 'cancelled'
  trialStartedAt: timestamp("trial_started_at"),
  trialEndsAt: timestamp("trial_ends_at"),
  parentDeveloperId: integer("parent_developer_id").references((): any => users.id), // For team members: points to the lead developer
  teamRole: text("team_role").notNull().default("owner"), // 'owner' | 'member'
  permissions: text("permissions").array().notNull().default(sql`ARRAY[]::text[]`), // Per-feature permission keys for team members; owners ignore (implicit all)
  role: text("role").notNull().default("user"), // 'user', 'admin', 'super_admin', 'investor', 'developer'
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
  // Developer Portal: optional ownership of this project by a developer user
  developerId: integer("developer_id").references((): any => users.id),
  developerEquityUnits: decimal("developer_equity_units", { precision: 15, scale: 2 }).notNull().default("0"),
  landSizeSqm: decimal("land_size_sqm", { precision: 12, scale: 2 }), // Total land size for partitioning (developer projects)
  projectStatus: text("project_status").notNull().default("live"), // 'draft' | 'pending_approval' | 'live' | 'sold_out' | 'archived'
  salesStage: text("sales_stage").notNull().default("off_plan"), // Lifecycle stage: 'off_plan' | 'completed'
  propertyType: varchar("property_type", { length: 50 }).default("land"),
  badge: text("badge"), // e.g., 'partnered', 'verified', etc.
  partnershipDocumentUrl: text("partnership_document_url"), // URL to signed partnership document
  partnershipDocumentName: text("partnership_document_name"), // Display name for document
  developerNotes: text("developer_notes"), // Notes from developer about the project
  investmentDetails: text("investment_details"), // Detailed investment information
  // Developer Portal: project-level construction/risk fields (managed in Construction tab)
  currentStage: text("current_stage"), // e.g. 'Land prep', 'Foundation', 'Structural frame', 'Finishes', 'Handover'
  expectedCompletionDate: timestamp("expected_completion_date"), // Developer-stated handover date
  // Schedule tracking — planned vs actual completion (rendered on the Construction tab)
  plannedStartDate: timestamp("planned_start_date"),
  plannedCompletionDate: timestamp("planned_completion_date"),
  actualCompletionDate: timestamp("actual_completion_date"),
  // Total project budget (in project currency). Used for budget rollup on the Construction tab.
  totalBudget: bigint("total_budget", { mode: "number" }),
  risksDelays: text("risks_delays"), // Free-form risks/delays notes
  latestUpdateText: text("latest_update_text"), // Short headline for the most recent project status
  currency: text("currency").notNull().default("NGN"), // Currency for property values (NGN = Nigerian Naira - platform default)
  
  // Unit-based investment tracking
  totalUnits: integer("total_units").notNull().default(0), // Total units available for the property
  reservedUnits: integer("reserved_units").notNull().default(0), // Units soft-locked for payment_pending reservations
  soldUnits: integer("sold_units").notNull().default(0), // Units confirmed and sold
  unitPrice: bigint("unit_price", { mode: "number" }).notNull().default(0), // Price per unit (entry price = cheapest unitTypes row)
  // Per-type breakdown captured in the wizard (estate: by plot size; vertical: by apartment type).
  // Each row: { label, quantity, price }. totalUnits/unitPrice/totalValue are derived from this.
  unitTypes: jsonb("unit_types").$type<Array<{ label: string; quantity: number; price: number }>>().default(sql`'[]'::jsonb`),
  totalSquareMeters: decimal("total_square_meters", { precision: 12, scale: 2 }), // Total land area in square meters
  unitPrecision: decimal("unit_precision", { precision: 10, scale: 2 }).notNull().default("1.00"), // Minimum step for unit selection (e.g., 0.1, 0.5, 1)
  
  isTransferable: boolean("is_transferable").notNull().default(false),
  valuationReportUrl: text("valuation_report_url"),
  valuationReportName: text("valuation_report_name"),
  
  // SPV (Special Purpose Vehicle) identification
  spvName: text("spv_name"),
  city: text("city"), // City for SPV generation (e.g., Abuja, Lagos)
  district: text("district"), // District/area for SPV generation (e.g., Guzape, Lekki)

  // Funding model — how this project is being funded and how investors are rewarded.
  // Multi-select: a project may combine models (e.g. equity + fixed_return).
  // Captured during project creation so the platform knows what to show investors and
  // what return/repayment terms the developer is committing to.
  // 'equity'        - Investors own a fractional share; returns from sale/appreciation/rental.
  // 'fixed_return'  - Developer commits a fixed % return paid back at end of term.
  // 'profit_share'  - Investors get a defined % of net profit at exit.
  // 'loan'          - Investors lend capital for a fixed term + interest, no ownership.
  // 'self_funded'   - No external investors needed; developer is funding the project.
  fundingTypes: text("funding_types").array().notNull().default(sql`ARRAY['equity']::text[]`),
  acceptsExternalInvestors: boolean("accepts_external_investors").notNull().default(true),
  expectedReturnPercent: decimal("expected_return_percent", { precision: 6, scale: 2 }), // e.g. 22.50 (%)
  returnPeriod: text("return_period"), // 'annual' | 'project_lifetime' | 'monthly' | 'quarterly'
  investmentTermMonths: integer("investment_term_months"), // Lock-up duration for fixed_return/loan
  payoutFrequency: text("payout_frequency"), // 'lump_sum' | 'monthly' | 'quarterly' | 'annually' | 'on_exit'
  exitStrategy: text("exit_strategy"), // 'sale' | 'buyback' | 'refinance' | 'rental_income' | 'land_appreciation' | 'other'
  fundingNotes: text("funding_notes"), // Free-form: payment plans, milestones, special terms
  
  // Land/title registration metadata (legacy columns preserved)
  firstOwnerName: text("first_owner_name"),
  fileNumber: text("file_number"),
  plotNumber: text("plot_number"),
  landDistrict: text("land_district"),
  landUse: text("land_use"),
  plotSize: text("plot_size"),
  cofoNumber: text("cofo_number"),
  cofoDate: timestamp("cofo_date"),
  rofoNumber: text("rofo_number"),
  rofoDate: timestamp("rofo_date"),
  registrationInfo: text("registration_info"),
  rentPerAnnum: text("rent_per_annum"),
  outstandingRent: text("outstanding_rent"),
  encumbranceActionDate: timestamp("encumbrance_action_date"),
  encumbranceNumber: text("encumbrance_number"),
  encumbrancePage: text("encumbrance_page"),
  encumbranceVolume: text("encumbrance_volume"),
  encumbranceDetails: text("encumbrance_details"),
  otherComments: text("other_comments"),
  
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
  // Snapshot of the unit-type label (from properties.unitTypes) the buyer chose.
  // Null for legacy rows or projects with no configured unit-type breakdown.
  unitTypeLabel: text("unit_type_label"),
  referralCode: text("referral_code"),
  status: text("status").notNull().default("reserved"), // 'reserved', 'expired', 'converted_to_investment', 'cancelled'
  // Developer-portal conversion funnel stage. Independent of platform-level `status`.
  // 'prospective' | 'due_diligence' | 'documentation' | 'payment_incomplete' | 'confirmed'
  funnelStage: text("funnel_stage"),
  // Throttle for "Send reminder" emails (one per 24h max) on the Sales tab.
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  
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
}).extend({
  // Restrict funnelStage to the 5 documented values (or null for out-of-funnel).
  // Values kept in sync with RESERVATION_FUNNEL_STAGES below.
  funnelStage: z.enum([
    "prospective",
    "due_diligence",
    "documentation",
    "payment_incomplete",
    "confirmed",
  ]).nullable().optional(),
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
  rawAssetValue: decimal("raw_asset_value", { precision: 20, scale: 2 }),
  investorBasisValue: decimal("investor_basis_value", { precision: 20, scale: 2 }),
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

export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerUserId: integer("referrer_user_id").notNull().references(() => users.id),
  referredUserId: integer("referred_user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const referralRewards = pgTable("referral_rewards", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  referralCount: integer("referral_count").notNull().default(0),
  rewardAmount: decimal("reward_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  rewardCurrency: text("reward_currency").notNull().default("USD"),
  payoutStatus: text("payout_status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const resaleListings = pgTable("resale_listings", {
  id: serial("id").primaryKey(),
  sellerId: integer("seller_id").notNull().references(() => users.id),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  reservationId: integer("reservation_id").notNull().references(() => investmentReservations.id),
  units: decimal("units", { precision: 15, scale: 2 }).notNull(),
  sellingType: text("selling_type").notNull(), // 'fixed_price' or 'bidding'
  askingPrice: decimal("asking_price", { precision: 20, scale: 2 }), // For fixed price listings
  minimumPrice: decimal("minimum_price", { precision: 20, scale: 2 }), // For bidding listings (reserve price)
  currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("pending_review"), // 'pending_review', 'approved', 'rejected', 'sold', 'cancelled', 'awaiting_payment'
  adminReviewNote: text("admin_review_note"),
  reviewedByAdminId: integer("reviewed_by_admin_id").references(() => adminUsers.id),
  reviewedAt: timestamp("reviewed_at"),
  biddingEndsAt: timestamp("bidding_ends_at"), // When bidding closes
  highestBidId: integer("highest_bid_id"), // Current winning bid
  winnerId: integer("winner_id").references(() => users.id), // The buyer (fixed price) or winning bidder
  paymentDeadline: timestamp("payment_deadline"), // Winner must pay by this time
  shareToken: text("share_token").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const resaleBids = pgTable("resale_bids", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id").notNull().references(() => resaleListings.id),
  bidderId: integer("bidder_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("active"), // 'active', 'outbid', 'won', 'lost', 'failed_payment'
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const resalePayments = pgTable("resale_payments", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id").notNull().references(() => resaleListings.id),
  buyerId: integer("buyer_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  paymentMethod: text("payment_method").notNull().default("bank_transfer"),
  bankReference: text("bank_reference"),
  proofUrl: text("proof_url"),
  proofType: text("proof_type"),
  status: text("status").notNull().default("pending_verification"), // 'pending_verification', 'approved', 'rejected'
  rejectionReason: text("rejection_reason"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  reviewedByAdminId: integer("reviewed_by_admin_id").references(() => adminUsers.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const resaleAuditLogs = pgTable("resale_audit_logs", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id").references(() => resaleListings.id),
  bidId: integer("bid_id").references(() => resaleBids.id),
  paymentId: integer("payment_id").references(() => resalePayments.id),
  propertyId: integer("property_id").references(() => properties.id),
  action: text("action").notNull(),
  actorType: text("actor_type").notNull(), // 'user', 'admin', 'system'
  actorId: integer("actor_id"),
  actorName: text("actor_name"),
  sellerId: integer("seller_id"),
  buyerId: integer("buyer_id"),
  units: text("units"),
  amount: text("amount"),
  currency: text("currency"),
  details: text("details"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertResaleAuditLogSchema = createInsertSchema(resaleAuditLogs).omit({
  id: true,
  createdAt: true,
});

export const insertResalePaymentSchema = createInsertSchema(resalePayments).omit({
  id: true,
  status: true,
  reviewedByAdminId: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
});

export const insertResaleBidSchema = createInsertSchema(resaleBids).omit({
  id: true,
  status: true,
  createdAt: true,
});

export const insertResaleListingSchema = createInsertSchema(resaleListings).omit({
  id: true,
  status: true,
  adminReviewNote: true,
  reviewedByAdminId: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReferralSchema = createInsertSchema(referrals).omit({
  id: true,
  createdAt: true,
});

export const insertReferralRewardSchema = createInsertSchema(referralRewards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const referralConfigSchema = z.object({
  tiers: z.array(z.object({
    count: z.number(),
    reward: z.number(),
  })),
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

export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

export type InsertReferralReward = z.infer<typeof insertReferralRewardSchema>;
export type ReferralReward = typeof referralRewards.$inferSelect;

export type InsertResaleListing = z.infer<typeof insertResaleListingSchema>;
export type ResaleListing = typeof resaleListings.$inferSelect;

export type InsertResaleBid = z.infer<typeof insertResaleBidSchema>;
export type ResaleBid = typeof resaleBids.$inferSelect;

export type InsertResalePayment = z.infer<typeof insertResalePaymentSchema>;
export type ResalePayment = typeof resalePayments.$inferSelect;

export type InsertResaleAuditLog = z.infer<typeof insertResaleAuditLogSchema>;
export type ResaleAuditLog = typeof resaleAuditLogs.$inferSelect;

// ============================================================================
// Developer Portal — Project Milestones, Updates, and Investor Notes
// ============================================================================

export const projectMilestones = pgTable("project_milestones", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  name: text("name").notNull(),
  description: text("description"),
  targetDate: timestamp("target_date"),
  completedDate: timestamp("completed_date"),
  status: text("status").notNull().default("not_started"), // 'not_started' | 'in_progress' | 'done' | 'delayed'
  percentComplete: integer("percent_complete").notNull().default(0),
  mediaUrls: text("media_urls").array(),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const projectUpdates = pgTable("project_updates", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  type: text("type").notNull().default("general"), // 'construction' | 'sales' | 'financial' | 'delay' | 'general'
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  mediaUrls: text("media_urls").array(),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const developerInvestorNotes = pgTable("developer_investor_notes", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  developerUserId: integer("developer_user_id").notNull().references(() => users.id),
  investorUserId: integer("investor_user_id").notNull().references(() => users.id),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqDevInvProp: uniqueIndex("dev_investor_notes_unique_idx")
    .on(table.propertyId, table.developerUserId, table.investorUserId),
}));

// Audit log of payment-reminder emails sent from the developer Sales tab.
// One row per send. Used to render reminder history on the owing-clients table
// (count + last few dates) so developers can see who they've already contacted
// and avoid pestering investors.
export const reservationReminders = pgTable("reservation_reminders", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().references(() => investmentReservations.id),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  sentByUserId: integer("sent_by_user_id").references(() => users.id),
  recipientEmail: text("recipient_email").notNull(),
});

// Developer-managed CRM leads (pre-reservation funnel: lead → contacted → qualified → converted/lost)
export const developerLeads = pgTable("developer_leads", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  developerUserId: integer("developer_user_id").notNull().references(() => users.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  stage: text("stage").notNull().default("lead"), // 'lead' | 'contacted' | 'qualified' | 'converted' | 'lost'
  estimatedUnits: decimal("estimated_units", { precision: 15, scale: 2 }),
  notes: text("notes"),
  convertedReservationId: integer("converted_reservation_id").references(() => investmentReservations.id),
  convertedAt: timestamp("converted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProjectMilestoneSchema = createInsertSchema(projectMilestones).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectUpdateSchema = createInsertSchema(projectUpdates).omit({
  id: true,
  recipientCount: true,
  sentAt: true,
  createdAt: true,
});

export const insertDeveloperInvestorNoteSchema = createInsertSchema(developerInvestorNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDeveloperLeadSchema = createInsertSchema(developerLeads).omit({
  id: true,
  convertedReservationId: true,
  convertedAt: true,
  createdAt: true,
  updatedAt: true,
});

// ============================================================================
// Developer Portal — Construction stages, vendors, vendor payments
// ============================================================================

// Predefined 8-stage construction template per project. One row per stage per project,
// auto-seeded by createProperty(). UI lets developers fill in planned/actual dates and
// per-stage budgets so we can render planned-vs-actual timeline + completion graphs.
export const constructionStages = pgTable("construction_stages", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  stageKey: text("stage_key").notNull(), // 'site_preparation' | 'foundation' | 'structure' | 'roofing' | 'mep' | 'finishes' | 'landscaping' | 'handover'
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  plannedStartDate: timestamp("planned_start_date"),
  plannedCompletionDate: timestamp("planned_completion_date"),
  actualStartDate: timestamp("actual_start_date"),
  actualCompletionDate: timestamp("actual_completion_date"),
  budgetAmount: decimal("budget_amount", { precision: 20, scale: 2 }),
  status: text("status").notNull().default("not_started"), // 'not_started' | 'in_progress' | 'done' | 'delayed'
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqStagePerProperty: uniqueIndex("construction_stages_property_key_idx").on(table.propertyId, table.stageKey),
}));

// Vendors / subcontractors working on a project, optionally tied to a specific construction stage.
export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  stageId: integer("stage_id").references(() => constructionStages.id),
  name: text("name").notNull(),
  workCategory: text("work_category"), // free-form, e.g. 'Plumbing', 'Roofing', 'Architect'
  contractAmount: decimal("contract_amount", { precision: 20, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("NGN"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // 'active' | 'completed' | 'cancelled'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Every payment a developer makes to a vendor. Uploaded receipts/proofs live in proofUrl.
export const vendorPayments = pgTable("vendor_payments", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  paidAt: timestamp("paid_at").notNull(),
  method: text("method"), // 'bank_transfer' | 'cash' | 'cheque' | 'card' | 'other'
  reference: text("reference"),
  proofUrl: text("proof_url"),
  proofType: text("proof_type"), // 'image' | 'pdf'
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConstructionStageSchema = createInsertSchema(constructionStages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVendorPaymentSchema = createInsertSchema(vendorPayments).omit({
  id: true,
  createdAt: true,
});

export type InsertConstructionStage = z.infer<typeof insertConstructionStageSchema>;
export type ConstructionStage = typeof constructionStages.$inferSelect;
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;
export type InsertVendorPayment = z.infer<typeof insertVendorPaymentSchema>;
export type VendorPayment = typeof vendorPayments.$inferSelect;

// Default 8-stage construction template auto-seeded on project creation.
export const DEFAULT_CONSTRUCTION_STAGES: { stageKey: string; name: string; sortOrder: number }[] = [
  { stageKey: "site_preparation", name: "Site Preparation", sortOrder: 0 },
  { stageKey: "foundation",       name: "Foundation",       sortOrder: 1 },
  { stageKey: "structure",        name: "Structure",        sortOrder: 2 },
  { stageKey: "roofing",          name: "Roofing",          sortOrder: 3 },
  { stageKey: "mep",              name: "MEP",              sortOrder: 4 },
  { stageKey: "finishes",         name: "Finishes",         sortOrder: 5 },
  { stageKey: "landscaping",      name: "Landscaping",      sortOrder: 6 },
  { stageKey: "handover",         name: "Handover",         sortOrder: 7 },
];

// Reservation funnel stages used by the Fundraising tab's funnel + conversion-efficiency charts.
export const RESERVATION_FUNNEL_STAGES = [
  "prospective",
  "due_diligence",
  "documentation",
  "payment_incomplete",
  "confirmed",
] as const;
export type ReservationFunnelStage = (typeof RESERVATION_FUNNEL_STAGES)[number];

// Developer team invites — for inviting project managers / co-workers under a Starter/Growth plan.
export const developerTeamInvites = pgTable("developer_team_invites", {
  id: serial("id").primaryKey(),
  developerId: integer("developer_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  inviteName: text("invite_name"),
  inviteRole: text("invite_role").notNull().default("project_manager"), // free-form label
  permissions: text("permissions").array().notNull().default(sql`ARRAY[]::text[]`), // Per-feature permission keys to grant on accept
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"), // 'pending' | 'accepted' | 'revoked' | 'expired'
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  acceptedUserId: integer("accepted_user_id").references((): any => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDeveloperTeamInviteSchema = createInsertSchema(developerTeamInvites).omit({
  id: true,
  status: true,
  acceptedAt: true,
  acceptedUserId: true,
  createdAt: true,
});

export type InsertDeveloperTeamInvite = z.infer<typeof insertDeveloperTeamInviteSchema>;
export type DeveloperTeamInvite = typeof developerTeamInvites.$inferSelect;

export const developerRegisterSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(5, "Phone is required"),
  companyName: z.string().min(2, "Company name is required"),
  companyRegistration: z.string().optional(),
  websiteUrl: z.string().optional(),
});

export type InsertProjectMilestone = z.infer<typeof insertProjectMilestoneSchema>;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;

export type InsertProjectUpdate = z.infer<typeof insertProjectUpdateSchema>;
export type ProjectUpdate = typeof projectUpdates.$inferSelect;

export type InsertDeveloperInvestorNote = z.infer<typeof insertDeveloperInvestorNoteSchema>;
export type DeveloperInvestorNote = typeof developerInvestorNotes.$inferSelect;

export type InsertDeveloperLead = z.infer<typeof insertDeveloperLeadSchema>;
export type DeveloperLead = typeof developerLeads.$inferSelect;

export type ReservationReminder = typeof reservationReminders.$inferSelect;
export const insertReservationReminderSchema = createInsertSchema(reservationReminders).omit({
  id: true,
  sentAt: true,
});
export type InsertReservationReminder = z.infer<typeof insertReservationReminderSchema>;

export type DeveloperRegister = z.infer<typeof developerRegisterSchema>;

// ============================================================================
// Contractor Portal — Projects, Budget, Expenses
// ============================================================================

export const contractorProjects = pgTable("contractor_projects", {
  id: serial("id").primaryKey(),
  contractorId: integer("contractor_id").notNull().references(() => users.id),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location"),
  projectType: text("project_type").notNull().default("residential"), // 'residential' | 'commercial' | 'infrastructure' | 'renovation' | 'other'
  currency: text("currency").notNull().default("NGN"),
  totalBudget: decimal("total_budget", { precision: 20, scale: 2 }),
  status: text("status").notNull().default("active"), // 'active' | 'completed' | 'on_hold' | 'cancelled'
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  clientName: text("client_name"),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const contractorBudgetCategories = pgTable("contractor_budget_categories", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => contractorProjects.id),
  name: text("name").notNull(), // e.g. 'Foundation', 'Labour', 'Materials'
  allocatedAmount: decimal("allocated_amount", { precision: 20, scale: 2 }).notNull().default("0"),
  color: text("color"), // hex color for charts
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contractorExpenses = pgTable("contractor_expenses", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => contractorProjects.id),
  categoryId: integer("category_id").references(() => contractorBudgetCategories.id),
  vendor: text("vendor"),
  description: text("description"),
  amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  expenseDate: timestamp("expense_date").notNull(),
  paymentMethod: text("payment_method"), // 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other'
  reference: text("reference"),
  receiptUrl: text("receipt_url"), // Cloudinary URL
  receiptType: text("receipt_type"), // 'image' | 'pdf'
  // AI extraction data — raw output from Claude Vision
  aiExtracted: jsonb("ai_extracted").$type<{
    vendor?: string;
    amount?: number;
    date?: string;
    description?: string;
    confidence?: number;
  }>(),
  status: text("status").notNull().default("confirmed"), // 'pending_review' | 'confirmed'
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const contractorProjectsRelations = relations(contractorProjects, ({ one, many }) => ({
  contractor: one(users, { fields: [contractorProjects.contractorId], references: [users.id] }),
  budgetCategories: many(contractorBudgetCategories),
  expenses: many(contractorExpenses),
}));

export const contractorBudgetCategoriesRelations = relations(contractorBudgetCategories, ({ one, many }) => ({
  project: one(contractorProjects, { fields: [contractorBudgetCategories.projectId], references: [contractorProjects.id] }),
  expenses: many(contractorExpenses),
}));

export const contractorExpensesRelations = relations(contractorExpenses, ({ one }) => ({
  project: one(contractorProjects, { fields: [contractorExpenses.projectId], references: [contractorProjects.id] }),
  category: one(contractorBudgetCategories, { fields: [contractorExpenses.categoryId], references: [contractorBudgetCategories.id] }),
}));

// Insert schemas
export const insertContractorProjectSchema = createInsertSchema(contractorProjects).omit({
  id: true,
  slug: true,
  contractorId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContractorBudgetCategorySchema = createInsertSchema(contractorBudgetCategories).omit({
  id: true,
  createdAt: true,
});

export const insertContractorExpenseSchema = createInsertSchema(contractorExpenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const contractorRegisterSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(5, "Phone is required"),
});

// Types
export type ContractorProject = typeof contractorProjects.$inferSelect;
export type InsertContractorProject = z.infer<typeof insertContractorProjectSchema>;
export type ContractorBudgetCategory = typeof contractorBudgetCategories.$inferSelect;
export type InsertContractorBudgetCategory = z.infer<typeof insertContractorBudgetCategorySchema>;
export type ContractorExpense = typeof contractorExpenses.$inferSelect;
export type InsertContractorExpense = z.infer<typeof insertContractorExpenseSchema>;
export type ContractorRegister = z.infer<typeof contractorRegisterSchema>;

