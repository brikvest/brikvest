import { pgTable, text, serial, integer, boolean, timestamp, decimal, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("user"), // 'user', 'admin', 'super_admin'
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
  projectedReturn: decimal("projected_return", { precision: 5, scale: 2 }).notNull(),
  availableSlots: integer("available_slots").notNull(),
  totalSlots: integer("total_slots").notNull(),
  fundingProgress: integer("funding_progress").notNull().default(0),
  imageUrl: text("image_url").notNull(),
  status: text("status").notNull().default("active"),
  badge: text("badge"), // e.g., 'partnered', 'verified', etc.
  partnershipDocumentUrl: text("partnership_document_url"), // URL to signed partnership document
  partnershipDocumentName: text("partnership_document_name"), // Display name for document
  developerNotes: text("developer_notes"), // Notes from developer about the project
  investmentDetails: text("investment_details"), // Detailed investment information
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const investmentReservations = pgTable("investment_reservations", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  units: integer("units").notNull(),
  referralCode: text("referral_code"),
  status: text("status").notNull().default("reserved"),
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

// Relations
export const propertiesRelations = relations(properties, ({ many }) => ({
  reservations: many(investmentReservations),
  groups: many(investmentGroups),
}));

export const investmentReservationsRelations = relations(investmentReservations, ({ one }) => ({
  property: one(properties, {
    fields: [investmentReservations.propertyId],
    references: [properties.id],
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

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
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
  status: true,
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

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type LoginCredentials = z.infer<typeof loginSchema>;

export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof properties.$inferSelect;

export type InsertInvestmentReservation = z.infer<typeof insertInvestmentReservationSchema>;
export type InvestmentReservation = typeof investmentReservations.$inferSelect;

export type InsertDeveloperBid = z.infer<typeof insertDeveloperBidSchema>;
export type DeveloperBid = typeof developerBids.$inferSelect;

export type InsertInvestmentGroup = z.infer<typeof insertInvestmentGroupSchema>;
export type InvestmentGroup = typeof investmentGroups.$inferSelect;

export type InsertGroupMembership = z.infer<typeof insertGroupMembershipSchema>;
export type GroupMembership = typeof groupMemberships.$inferSelect;
