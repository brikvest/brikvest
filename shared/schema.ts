import { pgTable, text, serial, integer, boolean, timestamp, decimal, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
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

// Investment Groups for collaborative investing
export const investmentGroups = pgTable("investment_groups", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull().references(() => properties.id),
  groupName: text("group_name").notNull(),
  description: text("description"),
  leaderName: text("leader_name").notNull(),
  leaderEmail: text("leader_email").notNull(),
  leaderPhone: text("leader_phone").notNull(),
  targetAmount: bigint("target_amount", { mode: "number" }).notNull(),
  targetUnits: integer("target_units").notNull(),
  currentAmount: bigint("current_amount", { mode: "number" }).notNull().default(0),
  inviteCode: text("invite_code").notNull().unique(),
  maxMembers: integer("max_members").notNull().default(10),
  status: text("status").notNull().default("recruiting"), // recruiting, funded, confirmed, closed
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groupMembers = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => investmentGroups.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  pledgedAmount: bigint("pledged_amount", { mode: "number" }).notNull(),
  contributedAmount: bigint("contributed_amount", { mode: "number" }).notNull().default(0),
  isLeader: boolean("is_leader").notNull().default(false),
  status: text("status").notNull().default("active"), // active, left, removed
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const groupContributions = pgTable("group_contributions", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => groupMembers.id),
  groupId: integer("group_id").notNull().references(() => investmentGroups.id),
  amount: bigint("amount", { mode: "number" }).notNull(),
  contributionDate: timestamp("contribution_date").defaultNow().notNull(),
  paymentMethod: text("payment_method"), // bank_transfer, card, etc.
  transactionRef: text("transaction_ref"),
  status: text("status").notNull().default("pending"), // pending, confirmed, failed
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

// Relations
export const propertiesRelations = relations(properties, ({ many }) => ({
  reservations: many(investmentReservations),
  investmentGroups: many(investmentGroups),
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
  members: many(groupMembers),
  contributions: many(groupContributions),
}));

export const groupMembersRelations = relations(groupMembers, ({ one, many }) => ({
  group: one(investmentGroups, {
    fields: [groupMembers.groupId],
    references: [investmentGroups.id],
  }),
  contributions: many(groupContributions),
}));

export const groupContributionsRelations = relations(groupContributions, ({ one }) => ({
  member: one(groupMembers, {
    fields: [groupContributions.memberId],
    references: [groupMembers.id],
  }),
  group: one(investmentGroups, {
    fields: [groupContributions.groupId],
    references: [investmentGroups.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
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
  status: true,
});

export const insertGroupMemberSchema = createInsertSchema(groupMembers).omit({
  id: true,
  joinedAt: true,
  contributedAmount: true,
  status: true,
  isLeader: true,
});

export const insertGroupContributionSchema = createInsertSchema(groupContributions).omit({
  id: true,
  contributionDate: true,
  status: true,
});

export const joinGroupSchema = z.object({
  inviteCode: z.string().min(1, "Invite code is required"),
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  pledgedAmount: z.number().min(1, "Pledged amount must be greater than 0"),
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof properties.$inferSelect;

export type InsertInvestmentReservation = z.infer<typeof insertInvestmentReservationSchema>;
export type InvestmentReservation = typeof investmentReservations.$inferSelect;

export type InsertDeveloperBid = z.infer<typeof insertDeveloperBidSchema>;
export type DeveloperBid = typeof developerBids.$inferSelect;

export type InsertInvestmentGroup = z.infer<typeof insertInvestmentGroupSchema>;
export type InvestmentGroup = typeof investmentGroups.$inferSelect;

export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type GroupMember = typeof groupMembers.$inferSelect;

export type InsertGroupContribution = z.infer<typeof insertGroupContributionSchema>;
export type GroupContribution = typeof groupContributions.$inferSelect;

export type JoinGroupData = z.infer<typeof joinGroupSchema>;
