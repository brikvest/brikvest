import { 
  users, 
  adminUsers,
  properties,
  investmentReservations,
  investmentPayments,
  investmentGroups,
  groupMemberships,
  verificationSteps,
  propertyVerificationChecklists,
  verificationStepCompletions,
  marketInsights,
  guzapeListings,
  ownershipCertificates,
  paymentSubmissions,
  propertyValuations,
  referrals,
  referralRewards,
  resaleListings,
  resaleBids,
  type User, 
  type InsertUser,
  type AdminUser,
  type InsertAdminUser,
  type Property,
  type InsertProperty,
  type InvestmentReservation,
  type InsertInvestmentReservation,
  type InvestmentGroup,
  type InsertInvestmentGroup,
  type GroupMembership,
  type InsertGroupMembership,
  type VerificationStep,
  type PropertyVerificationChecklist,
  type VerificationStepCompletion,
  type InsertVerificationStepCompletion,
  type MarketInsight,
  type InsertMarketInsight,
  type GuzapeListing,
  type InsertGuzapeListing,
  type OwnershipCertificate,
  type InsertOwnershipCertificate,
  type PaymentSubmission,
  type InsertPaymentSubmission,
  type PropertyValuation,
  type InsertPropertyValuation,
  type Referral,
  type InsertReferral,
  type ReferralReward,
  type InsertReferralReward,
  type ResaleListing,
  type InsertResaleListing,
  type ResaleBid,
  type InsertResaleBid,
  resalePayments,
  type ResalePayment,
  type InsertResalePayment,
  resaleAuditLogs,
  type ResaleAuditLog,
  type InsertResaleAuditLog,
  projectMilestones,
  type ProjectMilestone,
  type InsertProjectMilestone,
  projectUpdates,
  type ProjectUpdate,
  type InsertProjectUpdate,
  developerInvestorNotes,
  type DeveloperInvestorNote,
  type InsertDeveloperInvestorNote,
  developerLeads,
  type DeveloperLead,
  type InsertDeveloperLead,
  developerTeamInvites,
  type DeveloperTeamInvite,
  type InsertDeveloperTeamInvite,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, ne, or, sql, inArray, notInArray, lt, gte } from "drizzle-orm";

export interface IStorage {
  // User methods (Email/Password Auth)
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User>;
  updateUserPassword(id: number, password: string): Promise<void>;
  setPasswordResetToken(email: string, token: string, expiry: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  updateUserLastLogin(id: number): Promise<void>;
  updateUserKyc(id: number, kycData: Partial<User>): Promise<void>;
  getAllKycSubmissions(): Promise<User[]>;
  updateUserKycStatus(userId: number, status: string, rejectionReason?: string): Promise<void>;
  getPendingUsers(): Promise<User[]>;
  updateUserAccountStatus(userId: number, status: string): Promise<User>;
  
  // Admin user methods
  getAdminUser(id: number): Promise<AdminUser | undefined>;
  getAdminUserByUsername(username: string): Promise<AdminUser | undefined>;
  createAdminUser(user: InsertAdminUser): Promise<AdminUser>;
  updateAdminUserLastLogin(id: number): Promise<void>;
  
  // Property methods
  getProperties(): Promise<Property[]>; // All properties (admin use)
  getPublicProperties(): Promise<Property[]>; // Only non-archived properties (buyer use)
  getProperty(id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(id: number, property: InsertProperty): Promise<Property>;
  deleteProperty(id: number): Promise<void>;
  deleteDeveloperProject(id: number): Promise<void>;
  updatePropertySlots(propertyId: number, reservedUnits: number): Promise<void>;
  
  // Investment reservation methods
  createInvestmentReservation(reservation: InsertInvestmentReservation): Promise<InvestmentReservation>;
  getReservationsByEmail(email: string): Promise<InvestmentReservation[]>;
  getUserReservationsWithPropertyByEmail(email: string): Promise<(InvestmentReservation & { property?: Property })[]>;
  getReservationsByUserId(userId: number): Promise<InvestmentReservation[]>;
  getReservationsByProperty(propertyId: number): Promise<InvestmentReservation[]>;
  getAllReservations(): Promise<InvestmentReservation[]>;
  getReservation(id: number): Promise<InvestmentReservation | undefined>;
  updateReservation(id: number, updates: Partial<InvestmentReservation>): Promise<InvestmentReservation>;
  updatePropertyUnitCounts(propertyId: number, reservedDelta: number, soldDelta: number): Promise<void>;
  linkOrphanedReservationsToUser(userId: number, email: string): Promise<number>;
  extendReservationsOnKycSubmission(userId: number): Promise<number>;
  cleanupExpiredReservations(): Promise<{ cancelled: number; unitsReleased: number }>;
  
  // Investment group methods
  createInvestmentGroup(group: InsertInvestmentGroup): Promise<InvestmentGroup>;
  getInvestmentGroups(): Promise<InvestmentGroup[]>;
  getInvestmentGroup(id: number): Promise<InvestmentGroup | undefined>;
  getInvestmentGroupByInviteCode(inviteCode: string): Promise<InvestmentGroup | undefined>;
  updateInvestmentGroup(id: number, updates: Partial<InvestmentGroup>): Promise<InvestmentGroup>;
  
  // Group membership methods
  createGroupMembership(membership: InsertGroupMembership): Promise<GroupMembership>;
  getGroupMemberships(groupId: number): Promise<GroupMembership[]>;
  getMembershipsByEmail(email: string): Promise<GroupMembership[]>;
  updateGroupMembership(id: number, updates: Partial<GroupMembership>): Promise<GroupMembership>;
  
  // Verification methods
  getVerificationSteps(): Promise<VerificationStep[]>;
  getPropertyVerificationChecklist(propertyId: number): Promise<any[]>;
  updatePropertyVerificationChecklist(propertyId: number, enabledSteps: number[]): Promise<void>;
  updateVerificationStepCompletion(data: InsertVerificationStepCompletion): Promise<void>;
  
  // Market insights methods
  createMarketInsights(insights: InsertMarketInsight[]): Promise<MarketInsight[]>;
  getMarketInsights(location?: string): Promise<MarketInsight[]>;
  deleteOldInsights(daysOld: number): Promise<void>;
  
  // Guzape listings methods
  saveGuzapeListings(listings: InsertGuzapeListing[]): Promise<GuzapeListing[]>;
  getGuzapeListings(limit?: number): Promise<GuzapeListing[]>;
  
  // Investment payments methods (admin-assisted)
  createInvestmentPayment(payment: any): Promise<any>;
  getInvestmentPayments(reservationId: number): Promise<any[]>;
  
  // Ownership certificates methods
  createOwnershipCertificate(certificate: InsertOwnershipCertificate): Promise<OwnershipCertificate>;
  getCertificateByReservationId(reservationId: number): Promise<OwnershipCertificate | undefined>;
  getCertificateByVerificationToken(token: string): Promise<OwnershipCertificate | undefined>;
  getCertificateByCertificateNumber(certNumber: string): Promise<OwnershipCertificate | undefined>;
  getCertificatesByUserId(userId: number): Promise<OwnershipCertificate[]>;
  getNextCertificateNumber(): Promise<string>;
  
  // Payment submissions methods (user-initiated)
  createPaymentSubmission(submission: InsertPaymentSubmission): Promise<PaymentSubmission>;
  getPaymentSubmissionsByReservationId(reservationId: number): Promise<PaymentSubmission[]>;
  getPaymentSubmissionsByUserId(userId: number): Promise<PaymentSubmission[]>;
  getAllPendingPaymentSubmissions(): Promise<PaymentSubmission[]>;
  getPaymentSubmission(id: number): Promise<PaymentSubmission | undefined>;
  updatePaymentSubmission(id: number, updates: Partial<PaymentSubmission>): Promise<PaymentSubmission>;
  
  // Property valuation methods
  createPropertyValuation(valuation: InsertPropertyValuation): Promise<PropertyValuation>;
  getPropertyValuation(id: number): Promise<PropertyValuation | undefined>;
  getPropertyValuations(propertyId: number): Promise<PropertyValuation[]>;
  getLatestPropertyValuation(propertyId: number): Promise<PropertyValuation | undefined>;
  deletePropertyValuation(id: number): Promise<void>;
  
  // Referral methods
  getUserByReferralCode(referralCode: string): Promise<User | undefined>;
  createReferral(referral: InsertReferral): Promise<Referral>;
  getReferralsByReferrerId(userId: number): Promise<Referral[]>;
  getReferralCountByReferrerId(userId: number): Promise<number>;
  getReferralRewardByUserId(userId: number): Promise<ReferralReward | undefined>;
  upsertReferralReward(userId: number, referralCount: number, rewardAmount: number): Promise<ReferralReward>;
  getAllReferralRewards(): Promise<ReferralReward[]>;
  updateReferralRewardPayoutStatus(id: number, status: string): Promise<ReferralReward>;
  getAllUsers(): Promise<User[]>;
  
  // Resale listing methods
  createResaleListing(listing: InsertResaleListing): Promise<ResaleListing>;
  getResaleListingsByUser(userId: number): Promise<ResaleListing[]>;
  getResaleListingsByProperty(propertyId: number): Promise<ResaleListing[]>;
  getResaleListing(id: number): Promise<ResaleListing | undefined>;
  updateResaleListing(id: number, updates: Partial<ResaleListing>): Promise<ResaleListing>;
  getAllResaleListings(): Promise<ResaleListing[]>;
  getActiveResaleListings(): Promise<ResaleListing[]>;
  getActiveResaleListingsForReservation(reservationId: number): Promise<ResaleListing[]>;
  getResaleListingByShareToken(shareToken: string): Promise<ResaleListing | undefined>;
  
  // Resale bid methods
  createResaleBid(bid: InsertResaleBid): Promise<ResaleBid>;
  getBidsByListing(listingId: number): Promise<ResaleBid[]>;
  getHighestBidForListing(listingId: number): Promise<ResaleBid | undefined>;
  getNextHighestBidForListing(listingId: number, excludeBidderIds: number[]): Promise<ResaleBid | undefined>;
  getBidsByUser(userId: number): Promise<ResaleBid[]>;
  getResaleBid(id: number): Promise<ResaleBid | undefined>;
  updateResaleBid(id: number, updates: Partial<ResaleBid>): Promise<ResaleBid>;

  // Resale payment methods
  createResalePayment(payment: InsertResalePayment): Promise<ResalePayment>;
  getResalePayment(id: number): Promise<ResalePayment | undefined>;
  getResalePaymentsByListing(listingId: number): Promise<ResalePayment[]>;
  getResalePaymentsByBuyer(buyerId: number): Promise<ResalePayment[]>;
  getAllResalePayments(): Promise<ResalePayment[]>;
  updateResalePayment(id: number, updates: Partial<ResalePayment>): Promise<ResalePayment>;

  // Expired payment deadline listings
  getExpiredAwaitingPaymentListings(): Promise<ResaleListing[]>;

  // Resale audit log methods
  createResaleAuditLog(log: InsertResaleAuditLog): Promise<ResaleAuditLog>;
  getResaleAuditLogsByListing(listingId: number): Promise<ResaleAuditLog[]>;
  getResaleAuditLogsByProperty(propertyId: number): Promise<ResaleAuditLog[]>;
  getAllResaleAuditLogs(limit?: number): Promise<ResaleAuditLog[]>;

  // Developer Portal methods
  getPropertiesByDeveloper(developerId: number): Promise<Property[]>;
  getDevelopers(): Promise<User[]>;

  // Project milestones
  createProjectMilestone(milestone: InsertProjectMilestone): Promise<ProjectMilestone>;
  getMilestonesByProperty(propertyId: number): Promise<ProjectMilestone[]>;
  getMilestone(id: number): Promise<ProjectMilestone | undefined>;
  updateMilestone(id: number, updates: Partial<ProjectMilestone>): Promise<ProjectMilestone>;
  reorderMilestones(propertyId: number, items: { id: number; sortOrder: number }[]): Promise<ProjectMilestone[]>;
  deleteMilestone(id: number): Promise<void>;

  // Project updates
  createProjectUpdate(update: InsertProjectUpdate, recipientCount: number): Promise<ProjectUpdate>;
  getProjectUpdatesByProperty(propertyId: number): Promise<ProjectUpdate[]>;
  getProjectUpdatesByDeveloper(developerId: number): Promise<ProjectUpdate[]>;

  // Developer investor notes
  upsertDeveloperInvestorNote(note: InsertDeveloperInvestorNote): Promise<DeveloperInvestorNote>;
  getDeveloperInvestorNote(propertyId: number, developerUserId: number, investorUserId: number): Promise<DeveloperInvestorNote | undefined>;

  // Developer CRM leads (pre-reservation funnel)
  createDeveloperLead(lead: InsertDeveloperLead): Promise<DeveloperLead>;
  getDeveloperLeadsByProperty(propertyId: number): Promise<DeveloperLead[]>;
  getDeveloperLead(id: number): Promise<DeveloperLead | undefined>;
  updateDeveloperLead(id: number, updates: Partial<DeveloperLead>): Promise<DeveloperLead>;
  deleteDeveloperLead(id: number): Promise<void>;

  // Developer subscription / team helpers
  getDeveloperOwnerId(userId: number): Promise<number>;
  getTeamMembersByDeveloper(developerId: number): Promise<User[]>;
  countActiveProjectsForDeveloper(developerId: number): Promise<number>;
  countDistinctInvestorsForDeveloper(developerId: number): Promise<number>;
  countUpdatesThisMonthForDeveloper(developerId: number): Promise<number>;

  // Developer team invites
  createDeveloperTeamInvite(invite: InsertDeveloperTeamInvite): Promise<DeveloperTeamInvite>;
  getDeveloperTeamInvitesByDeveloper(developerId: number): Promise<DeveloperTeamInvite[]>;
  getDeveloperTeamInviteByToken(token: string): Promise<DeveloperTeamInvite | undefined>;
  updateDeveloperTeamInvite(id: number, updates: Partial<DeveloperTeamInvite>): Promise<DeveloperTeamInvite>;
}

export class DatabaseStorage implements IStorage {
  // User methods (Email/Password Auth)
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User> {
    const [user] = await db.update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserPassword(id: number, password: string): Promise<void> {
    await db.update(users)
      .set({ password, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async setPasswordResetToken(email: string, token: string, expiry: Date): Promise<void> {
    await db.update(users)
      .set({ resetToken: token, resetTokenExpiry: expiry, updatedAt: new Date() })
      .where(eq(users.email, email));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async updateUserLastLogin(id: number): Promise<void> {
    await db.update(users)
      .set({ lastLogin: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateUserKyc(id: number, kycData: Partial<User>): Promise<void> {
    await db.update(users)
      .set({ ...kycData, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async getAllKycSubmissions(): Promise<User[]> {
    return await db.select().from(users)
      .where(ne(users.kycStatus, 'not_started'))
      .orderBy(desc(users.kycSubmittedAt));
  }

  async updateUserKycStatus(userId: number, status: string, rejectionReason?: string): Promise<void> {
    await db.update(users)
      .set({ 
        kycStatus: status as 'not_started' | 'submitted' | 'approved' | 'rejected',
        kycVerifiedAt: status === 'approved' ? new Date() : undefined,
        kycRejectionReason: status === 'rejected' ? (rejectionReason || null) : null,
        updatedAt: new Date() 
      })
      .where(eq(users.id, userId));
  }

  async getPendingUsers(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.accountStatus, 'pending')).orderBy(desc(users.createdAt));
  }

  async updateUserAccountStatus(userId: number, status: string): Promise<User> {
    const [user] = await db.update(users)
      .set({ accountStatus: status, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  // Admin user methods
  async getAdminUser(id: number): Promise<AdminUser | undefined> {
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
    return user;
  }

  async getAdminUserByUsername(username: string): Promise<AdminUser | undefined> {
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    return user;
  }

  async createAdminUser(insertUser: InsertAdminUser): Promise<AdminUser> {
    const [user] = await db.insert(adminUsers).values(insertUser).returning();
    return user;
  }

  async updateAdminUserLastLogin(id: number): Promise<void> {
    await db.update(adminUsers).set({
      lastLogin: new Date(),
    }).where(eq(adminUsers.id, id));
  }

  // Property methods - All properties (admin use)
  async getProperties(): Promise<Property[]> {
    return await db.select().from(properties).orderBy(desc(properties.createdAt));
  }

  // Public properties only (buyer use) - excludes archived properties.
  // Also hides developer-owned projects that are still draft or pending approval —
  // those must only be visible to the owning developer and admins, not to investors.
  async getPublicProperties(): Promise<Property[]> {
    const all = await db.select().from(properties)
      .where(ne(properties.status, 'archived'))
      .orderBy(desc(properties.createdAt));
    return all.filter(p =>
      // Admin-created properties (no developerId) are visible
      !p.developerId ||
      // Developer-owned properties only visible once approved (live or sold_out)
      p.projectStatus === 'live' ||
      p.projectStatus === 'sold_out'
    );
  }

  async getProperty(id: number): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property || undefined;
  }

  async createProperty(insertProperty: InsertProperty): Promise<Property> {
    const [property] = await db
      .insert(properties)
      .values(insertProperty)
      .returning();
    return property;
  }

  async updateProperty(id: number, updateData: InsertProperty): Promise<Property> {
    const [property] = await db
      .update(properties)
      .set(updateData)
      .where(eq(properties.id, id))
      .returning();
    return property;
  }

  async deleteProperty(id: number): Promise<void> {
    await db.delete(properties).where(eq(properties.id, id));
  }

  // Cascade-delete a developer project and every child row that references it.
  // Caller must verify ownership/permission and confirm there are no active
  // confirmed investors before invoking.
  async deleteDeveloperProject(id: number): Promise<void> {
    // Resale audit chain
    await db.delete(resaleAuditLogs).where(eq(resaleAuditLogs.propertyId, id));
    const listings = await db.select({ id: resaleListings.id }).from(resaleListings).where(eq(resaleListings.propertyId, id));
    const listingIds = listings.map(l => l.id);
    if (listingIds.length) {
      await db.delete(resaleAuditLogs).where(inArray(resaleAuditLogs.listingId, listingIds));
      await db.delete(resalePayments).where(inArray(resalePayments.listingId, listingIds));
      await db.delete(resaleBids).where(inArray(resaleBids.listingId, listingIds));
    }
    await db.delete(resaleListings).where(eq(resaleListings.propertyId, id));

    // Reservation-linked rows
    const reservations = await db.select({ id: investmentReservations.id }).from(investmentReservations).where(eq(investmentReservations.propertyId, id));
    const reservationIds = reservations.map(r => r.id);
    if (reservationIds.length) {
      await db.delete(ownershipCertificates).where(inArray(ownershipCertificates.reservationId, reservationIds));
      await db.delete(paymentSubmissions).where(inArray(paymentSubmissions.reservationId, reservationIds));
      await db.delete(investmentPayments).where(inArray(investmentPayments.reservationId, reservationIds));
      // Null out lead -> reservation links so we can drop the reservations
      await db.update(developerLeads)
        .set({ convertedReservationId: null as any })
        .where(inArray(developerLeads.convertedReservationId, reservationIds));
    }

    // Property-scoped child tables
    await db.delete(developerLeads).where(eq(developerLeads.propertyId, id));
    await db.delete(developerInvestorNotes).where(eq(developerInvestorNotes.propertyId, id));
    await db.delete(projectUpdates).where(eq(projectUpdates.propertyId, id));
    await db.delete(projectMilestones).where(eq(projectMilestones.propertyId, id));
    await db.delete(propertyValuations).where(eq(propertyValuations.propertyId, id));
    await db.delete(verificationStepCompletions).where(eq(verificationStepCompletions.propertyId, id));
    await db.delete(propertyVerificationChecklists).where(eq(propertyVerificationChecklists.propertyId, id));
    await db.delete(investmentReservations).where(eq(investmentReservations.propertyId, id));

    // Investment groups carry a nullable property reference — detach rather than delete.
    await db.update(investmentGroups)
      .set({ propertyId: null as any })
      .where(eq(investmentGroups.propertyId, id));

    await db.delete(properties).where(eq(properties.id, id));
  }

  async updatePropertySlots(propertyId: number, reservedUnits: number): Promise<void> {
    const [property] = await db.select().from(properties).where(eq(properties.id, propertyId));
    
    if (property) {
      const newAvailableSlots = property.availableSlots - reservedUnits;
      const newFundingProgress = Math.round(((property.totalSlots - newAvailableSlots) / property.totalSlots) * 100);
      
      await db
        .update(properties)
        .set({ 
          availableSlots: newAvailableSlots,
          fundingProgress: newFundingProgress
        })
        .where(eq(properties.id, propertyId));
    }
  }

  // Investment reservation methods
  async createInvestmentReservation(reservation: InsertInvestmentReservation): Promise<InvestmentReservation> {
    const [newReservation] = await db
      .insert(investmentReservations)
      .values(reservation)
      .returning();

    // Update property slots and funding progress
    const units = typeof reservation.units === 'string' ? parseFloat(reservation.units) : reservation.units;
    await this.updatePropertySlots(reservation.propertyId, units);
    
    return newReservation;
  }

  async getReservationsByEmail(email: string): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.email, email))
      .orderBy(desc(investmentReservations.createdAt));
  }

  async getUserReservationsWithPropertyByEmail(email: string): Promise<(InvestmentReservation & { property?: Property })[]> {
    const reservations = await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.email, email))
      .orderBy(desc(investmentReservations.createdAt));
    
    // Fetch property details for each reservation
    const reservationsWithProperty = await Promise.all(
      reservations.map(async (reservation) => {
        const property = await this.getProperty(reservation.propertyId);
        return { ...reservation, property: property || undefined };
      })
    );
    
    return reservationsWithProperty;
  }

  async getReservationsByUserId(userId: number): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.userId, userId))
      .orderBy(desc(investmentReservations.createdAt));
  }

  async linkOrphanedReservationsToUser(userId: number, email: string): Promise<number> {
    const result = await db
      .update(investmentReservations)
      .set({ userId })
      .where(
        and(
          eq(investmentReservations.email, email),
          sql`${investmentReservations.userId} IS NULL`
        )
      );
    
    return result.rowCount || 0;
  }

  async extendReservationsOnKycSubmission(userId: number): Promise<number> {
    const now = new Date();
    const extensionMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    
    // First, get eligible reservations to extend individually
    const eligibleReservations = await db
      .select()
      .from(investmentReservations)
      .where(
        and(
          eq(investmentReservations.userId, userId),
          eq(investmentReservations.status, 'reserved'),
          sql`${investmentReservations.kycExtendedAt} IS NULL`
        )
      );
    
    if (eligibleReservations.length === 0) {
      return 0;
    }
    
    let extendedCount = 0;
    
    for (const reservation of eligibleReservations) {
      // Calculate new expiry: add 24h from the later of (current expiry, now)
      const currentExpiry = reservation.expiresAt ? new Date(reservation.expiresAt) : now;
      const baseTime = currentExpiry > now ? currentExpiry : now;
      const newExpiry = new Date(baseTime.getTime() + extensionMs);
      
      await db
        .update(investmentReservations)
        .set({ 
          expiresAt: newExpiry,
          kycExtendedAt: now,
          updatedAt: now
        })
        .where(eq(investmentReservations.id, reservation.id));
      
      extendedCount++;
      console.log(`[KYC-EXTENSION] Extended reservation ${reservation.id} from ${currentExpiry.toISOString()} to ${newExpiry.toISOString()}`);
    }
    
    if (extendedCount > 0) {
      console.log(`[KYC-EXTENSION] Extended ${extendedCount} reservation(s) by 24 hours for user ${userId} due to KYC submission`);
    }
    
    return extendedCount;
  }

  async cleanupExpiredReservations(): Promise<{ cancelled: number; unitsReleased: number }> {
    const now = new Date();
    
    const expiredReservations = await db
      .select()
      .from(investmentReservations)
      .where(
        and(
          eq(investmentReservations.status, 'reserved'),
          sql`${investmentReservations.expiresAt} IS NOT NULL`,
          sql`${investmentReservations.expiresAt} < ${now}`
        )
      );
    
    if (expiredReservations.length === 0) {
      return { cancelled: 0, unitsReleased: 0 };
    }
    
    let totalCancelled = 0;
    let totalUnitsReleased = 0;
    
    for (const reservation of expiredReservations) {
      // Check if reservation has a pending payment submission - if so, protect it from expiration
      const pendingSubmissions = await db
        .select()
        .from(paymentSubmissions)
        .where(
          and(
            eq(paymentSubmissions.reservationId, reservation.id),
            eq(paymentSubmissions.status, 'pending_admin_review')
          )
        );
      
      if (pendingSubmissions.length > 0) {
        console.log(`[CLEANUP] Skipped reservation ${reservation.id} - has pending payment proof awaiting admin review`);
        continue;
      }

      const units = typeof reservation.units === 'string' 
        ? parseFloat(reservation.units) 
        : Number(reservation.units) || 0;
      
      const [updated] = await db
        .update(investmentReservations)
        .set({ status: 'expired' })
        .where(
          and(
            eq(investmentReservations.id, reservation.id),
            eq(investmentReservations.status, 'reserved'),
            sql`${investmentReservations.expiresAt} IS NOT NULL`,
            sql`${investmentReservations.expiresAt} < ${now}`
          )
        )
        .returning();
      
      if (!updated) {
        console.log(`[CLEANUP] Skipped reservation ${reservation.id} - status changed during cleanup`);
        continue;
      }
      
      totalCancelled++;
      
      if (units > 0 && reservation.propertyId) {
        await db
          .update(properties)
          .set({
            availableSlots: sql`${properties.availableSlots} + ${units}`,
            reservedUnits: sql`GREATEST(0, ${properties.reservedUnits} - ${units})`
          })
          .where(eq(properties.id, reservation.propertyId));
        
        totalUnitsReleased += units;
      }
      
      console.log(`[CLEANUP] Cancelled expired reservation ${reservation.id} (${reservation.email}), released ${units} units`);
    }
    
    console.log(`[CLEANUP] Total: ${totalCancelled} reservations cancelled, ${totalUnitsReleased} units released`);
    
    return { cancelled: totalCancelled, unitsReleased: totalUnitsReleased };
  }

  async getReservationsByProperty(propertyId: number): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.propertyId, propertyId))
      .orderBy(desc(investmentReservations.createdAt));
  }

  async getAllReservations(): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .orderBy(desc(investmentReservations.createdAt));
  }

  async getReservation(id: number): Promise<InvestmentReservation | undefined> {
    const [reservation] = await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.id, id));
    return reservation;
  }

  async updateReservation(id: number, updates: Partial<InvestmentReservation>): Promise<InvestmentReservation> {
    const [updated] = await db
      .update(investmentReservations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(investmentReservations.id, id))
      .returning();
    return updated;
  }

  async updatePropertyUnitCounts(propertyId: number, reservedDelta: number, soldDelta: number): Promise<void> {
    // Get the property to determine which system to use
    const property = await this.getProperty(propertyId);
    if (!property) return;

    // Calculate total delta for slots system
    const totalDelta = reservedDelta + soldDelta;
    
    await db
      .update(properties)
      .set({
        // Update new units system
        reservedUnits: sql`${properties.reservedUnits} + ${reservedDelta}`,
        soldUnits: sql`${properties.soldUnits} + ${soldDelta}`,
        // Also update legacy slots system if it's being used
        ...(property.totalSlots && property.totalSlots > 0 ? {
          availableSlots: sql`${properties.availableSlots} - ${totalDelta}`,
        } : {}),
      })
      .where(eq(properties.id, propertyId));
  }

  // Investment group methods
  async createInvestmentGroup(group: InsertInvestmentGroup): Promise<InvestmentGroup> {
    const [newGroup] = await db
      .insert(investmentGroups)
      .values(group)
      .returning();
    return newGroup;
  }

  async getInvestmentGroups(): Promise<InvestmentGroup[]> {
    return await db
      .select()
      .from(investmentGroups)
      .orderBy(desc(investmentGroups.createdAt));
  }

  async getInvestmentGroup(id: number): Promise<InvestmentGroup | undefined> {
    const [group] = await db.select().from(investmentGroups).where(eq(investmentGroups.id, id));
    return group || undefined;
  }

  async getInvestmentGroupByInviteCode(inviteCode: string): Promise<InvestmentGroup | undefined> {
    const [group] = await db.select().from(investmentGroups).where(eq(investmentGroups.inviteCode, inviteCode));
    return group || undefined;
  }

  async updateInvestmentGroup(id: number, updates: Partial<InvestmentGroup>): Promise<InvestmentGroup> {
    const [updatedGroup] = await db
      .update(investmentGroups)
      .set(updates)
      .where(eq(investmentGroups.id, id))
      .returning();
    return updatedGroup;
  }

  // Group membership methods
  async createGroupMembership(membership: InsertGroupMembership): Promise<GroupMembership> {
    const [newMembership] = await db
      .insert(groupMemberships)
      .values(membership)
      .returning();
    return newMembership;
  }

  async getGroupMemberships(groupId: number): Promise<GroupMembership[]> {
    return await db
      .select()
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupId))
      .orderBy(desc(groupMemberships.joinedAt));
  }

  async getMembershipsByEmail(email: string): Promise<GroupMembership[]> {
    return await db
      .select()
      .from(groupMemberships)
      .where(eq(groupMemberships.memberEmail, email))
      .orderBy(desc(groupMemberships.joinedAt));
  }

  async updateGroupMembership(id: number, updates: Partial<GroupMembership>): Promise<GroupMembership> {
    const [updatedMembership] = await db
      .update(groupMemberships)
      .set(updates)
      .where(eq(groupMemberships.id, id))
      .returning();
    return updatedMembership;
  }

  // Verification methods
  async getVerificationSteps(): Promise<VerificationStep[]> {
    return await db
      .select()
      .from(verificationSteps)
      .orderBy(verificationSteps.order);
  }

  async getPropertyVerificationChecklist(propertyId: number): Promise<any[]> {
    // Get all verification steps
    const steps = await this.getVerificationSteps();
    
    // Get enabled steps for this property
    const enabledSteps = await db
      .select()
      .from(propertyVerificationChecklists)
      .where(eq(propertyVerificationChecklists.propertyId, propertyId));
    
    // Get completion status for each step
    const completions = await db
      .select()
      .from(verificationStepCompletions)
      .where(eq(verificationStepCompletions.propertyId, propertyId));
    
    // Combine the data
    return steps.map(step => {
      const enabled = enabledSteps.find(e => e.verificationStepId === step.id);
      const completion = completions.find(c => c.verificationStepId === step.id);
      
      return {
        ...step,
        isEnabled: !!enabled?.isEnabled,
        isCompleted: !!completion?.isCompleted,
        completedAt: completion?.completedAt,
        completedBy: completion?.completedBy,
        proofPhotos: completion?.proofPhotos || [],
        notes: completion?.notes
      };
    });
  }

  async updatePropertyVerificationChecklist(propertyId: number, enabledSteps: number[]): Promise<void> {
    // First, remove all existing checklist items for this property
    await db
      .delete(propertyVerificationChecklists)
      .where(eq(propertyVerificationChecklists.propertyId, propertyId));
    
    // Then, insert the new enabled steps
    if (enabledSteps.length > 0) {
      const checklistItems = enabledSteps.map(stepId => ({
        propertyId,
        verificationStepId: stepId,
        isEnabled: true
      }));
      
      await db
        .insert(propertyVerificationChecklists)
        .values(checklistItems);
    }
  }

  async updateVerificationStepCompletion(data: InsertVerificationStepCompletion): Promise<void> {
    // Check if completion record exists
    const [existing] = await db
      .select()
      .from(verificationStepCompletions)
      .where(
        and(
          eq(verificationStepCompletions.propertyId, data.propertyId),
          eq(verificationStepCompletions.verificationStepId, data.verificationStepId)
        )
      );
    
    if (existing) {
      // Update existing record
      await db
        .update(verificationStepCompletions)
        .set({
          ...data,
          updatedAt: new Date()
        })
        .where(eq(verificationStepCompletions.id, existing.id));
    } else {
      // Insert new record
      await db
        .insert(verificationStepCompletions)
        .values(data);
    }
  }

  // Market insights methods
  async createMarketInsights(insights: InsertMarketInsight[]): Promise<MarketInsight[]> {
    if (insights.length === 0) return [];
    
    const result = await db
      .insert(marketInsights)
      .values(insights)
      .returning();
    
    return result;
  }

  async getMarketInsights(location?: string): Promise<MarketInsight[]> {
    if (location) {
      return db
        .select()
        .from(marketInsights)
        .where(eq(marketInsights.location, location))
        .orderBy(desc(marketInsights.scrapedAt));
    }
    
    return db
      .select()
      .from(marketInsights)
      .orderBy(desc(marketInsights.scrapedAt));
  }

  async deleteOldInsights(daysOld: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    await db
      .delete(marketInsights)
      .where(eq(marketInsights.scrapedAt, cutoffDate));
  }

  // Guzape listings methods
  async saveGuzapeListings(listings: InsertGuzapeListing[]): Promise<GuzapeListing[]> {
    if (listings.length === 0) return [];
    
    const result = await db
      .insert(guzapeListings)
      .values(listings)
      .onConflictDoUpdate({
        target: guzapeListings.listingId,
        set: {
          title: sql`excluded.title`,
          priceNgnRaw: sql`excluded.price_ngn_raw`,
          priceNgn: sql`excluded.price_ngn`,
          city: sql`excluded.city`,
          area: sql`excluded.area`,
          beds: sql`excluded.beds`,
          baths: sql`excluded.baths`,
          toilets: sql`excluded.toilets`,
          image: sql`excluded.image`,
          detailUrl: sql`excluded.detail_url`,
          scrapedAt: sql`excluded.scraped_at`,
        }
      })
      .returning();
    
    return result;
  }

  async getGuzapeListings(limit?: number): Promise<GuzapeListing[]> {
    const query = db
      .select()
      .from(guzapeListings)
      .orderBy(desc(guzapeListings.scrapedAt));
    
    if (limit) {
      return query.limit(limit);
    }
    
    return query;
  }

  // Investment payments methods
  async createInvestmentPayment(payment: any): Promise<any> {
    const [newPayment] = await db
      .insert(investmentPayments)
      .values(payment)
      .returning();
    return newPayment;
  }

  async getInvestmentPayments(reservationId: number): Promise<any[]> {
    return await db
      .select()
      .from(investmentPayments)
      .where(eq(investmentPayments.reservationId, reservationId))
      .orderBy(desc(investmentPayments.recordedAt));
  }

  // Ownership certificates methods
  async createOwnershipCertificate(certificate: InsertOwnershipCertificate): Promise<OwnershipCertificate> {
    const [newCertificate] = await db
      .insert(ownershipCertificates)
      .values(certificate)
      .returning();
    return newCertificate;
  }

  async getCertificateByReservationId(reservationId: number): Promise<OwnershipCertificate | undefined> {
    const [certificate] = await db
      .select()
      .from(ownershipCertificates)
      .where(eq(ownershipCertificates.reservationId, reservationId));
    return certificate;
  }

  async getCertificateByVerificationToken(token: string): Promise<OwnershipCertificate | undefined> {
    const [certificate] = await db
      .select()
      .from(ownershipCertificates)
      .where(eq(ownershipCertificates.verificationToken, token));
    return certificate;
  }

  async getCertificateByCertificateNumber(certNumber: string): Promise<OwnershipCertificate | undefined> {
    const [certificate] = await db
      .select()
      .from(ownershipCertificates)
      .where(eq(ownershipCertificates.certificateNumber, certNumber));
    return certificate;
  }

  async getCertificatesByUserId(userId: number): Promise<OwnershipCertificate[]> {
    // Get certificates for reservations belonging to this user
    const userReservations = await db
      .select({ id: investmentReservations.id })
      .from(investmentReservations)
      .where(eq(investmentReservations.userId, userId));
    
    if (userReservations.length === 0) {
      return [];
    }

    const reservationIds = userReservations.map(r => r.id);
    const certificates = await db
      .select()
      .from(ownershipCertificates)
      .where(inArray(ownershipCertificates.reservationId, reservationIds));
    
    return certificates;
  }

  async getNextCertificateNumber(): Promise<string> {
    // Format: CERT-YYYY-NNNNN
    const year = new Date().getFullYear();
    const prefix = `CERT-${year}-`;
    
    // Get the highest certificate number for this year
    const [latestCert] = await db
      .select({ certificateNumber: ownershipCertificates.certificateNumber })
      .from(ownershipCertificates)
      .where(sql`${ownershipCertificates.certificateNumber} LIKE ${prefix + '%'}`)
      .orderBy(desc(ownershipCertificates.certificateNumber))
      .limit(1);
    
    let nextNumber = 1;
    if (latestCert) {
      const lastNumber = parseInt(latestCert.certificateNumber.split('-')[2], 10);
      nextNumber = lastNumber + 1;
    }
    
    return `${prefix}${nextNumber.toString().padStart(5, '0')}`;
  }

  // Payment submissions methods (user-initiated payment proof uploads)
  async createPaymentSubmission(submission: InsertPaymentSubmission): Promise<PaymentSubmission> {
    const [result] = await db.insert(paymentSubmissions).values(submission).returning();
    return result;
  }

  async getPaymentSubmissionsByReservationId(reservationId: number): Promise<PaymentSubmission[]> {
    return await db.select()
      .from(paymentSubmissions)
      .where(eq(paymentSubmissions.reservationId, reservationId))
      .orderBy(desc(paymentSubmissions.uploadedAt));
  }

  async getPaymentSubmissionsByUserId(userId: number): Promise<PaymentSubmission[]> {
    return await db.select()
      .from(paymentSubmissions)
      .where(eq(paymentSubmissions.userId, userId))
      .orderBy(desc(paymentSubmissions.uploadedAt));
  }

  async getAllPendingPaymentSubmissions(): Promise<PaymentSubmission[]> {
    return await db.select()
      .from(paymentSubmissions)
      .where(eq(paymentSubmissions.status, 'pending_admin_review'))
      .orderBy(desc(paymentSubmissions.uploadedAt));
  }

  async getPaymentSubmission(id: number): Promise<PaymentSubmission | undefined> {
    const [submission] = await db.select()
      .from(paymentSubmissions)
      .where(eq(paymentSubmissions.id, id));
    return submission;
  }

  async updatePaymentSubmission(id: number, updates: Partial<PaymentSubmission>): Promise<PaymentSubmission> {
    const [result] = await db.update(paymentSubmissions)
      .set(updates)
      .where(eq(paymentSubmissions.id, id))
      .returning();
    return result;
  }

  async createPropertyValuation(valuation: InsertPropertyValuation): Promise<PropertyValuation> {
    const [result] = await db.insert(propertyValuations).values(valuation).returning();
    return result;
  }

  async getPropertyValuation(id: number): Promise<PropertyValuation | undefined> {
    const [valuation] = await db.select()
      .from(propertyValuations)
      .where(eq(propertyValuations.id, id));
    return valuation;
  }

  async getPropertyValuations(propertyId: number): Promise<PropertyValuation[]> {
    return await db.select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, propertyId))
      .orderBy(propertyValuations.valuationDate);
  }

  async getLatestPropertyValuation(propertyId: number): Promise<PropertyValuation | undefined> {
    const [result] = await db.select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, propertyId))
      .orderBy(desc(propertyValuations.valuationDate))
      .limit(1);
    return result;
  }

  async deletePropertyValuation(id: number): Promise<void> {
    await db.delete(propertyValuations).where(eq(propertyValuations.id, id));
  }

  async getUserByReferralCode(referralCode: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, referralCode));
    return user;
  }

  async createReferral(referral: InsertReferral): Promise<Referral> {
    const [result] = await db.insert(referrals).values(referral).returning();
    return result;
  }

  async getReferralsByReferrerId(userId: number): Promise<Referral[]> {
    return await db.select()
      .from(referrals)
      .where(eq(referrals.referrerUserId, userId))
      .orderBy(desc(referrals.createdAt));
  }

  async getReferralCountByReferrerId(userId: number): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(referrals)
      .where(and(eq(referrals.referrerUserId, userId), eq(referrals.status, 'completed')));
    return result[0]?.count || 0;
  }

  async getReferralRewardByUserId(userId: number): Promise<ReferralReward | undefined> {
    const [result] = await db.select().from(referralRewards).where(eq(referralRewards.userId, userId));
    return result;
  }

  async upsertReferralReward(userId: number, referralCount: number, rewardAmount: number): Promise<ReferralReward> {
    const existing = await this.getReferralRewardByUserId(userId);
    if (existing) {
      const [result] = await db.update(referralRewards)
        .set({ referralCount, rewardAmount: rewardAmount.toString(), updatedAt: new Date() })
        .where(eq(referralRewards.userId, userId))
        .returning();
      return result;
    }
    const [result] = await db.insert(referralRewards).values({
      userId,
      referralCount,
      rewardAmount: rewardAmount.toString(),
    }).returning();
    return result;
  }

  async getAllReferralRewards(): Promise<ReferralReward[]> {
    return await db.select().from(referralRewards).orderBy(desc(referralRewards.updatedAt));
  }

  async updateReferralRewardPayoutStatus(id: number, status: string): Promise<ReferralReward> {
    const [result] = await db.update(referralRewards)
      .set({ payoutStatus: status, updatedAt: new Date() })
      .where(eq(referralRewards.id, id))
      .returning();
    return result;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async createResaleListing(listing: InsertResaleListing): Promise<ResaleListing> {
    const [result] = await db.insert(resaleListings).values(listing).returning();
    return result;
  }

  async getResaleListingsByUser(userId: number): Promise<ResaleListing[]> {
    return await db.select().from(resaleListings)
      .where(eq(resaleListings.sellerId, userId))
      .orderBy(desc(resaleListings.createdAt));
  }

  async getResaleListingsByProperty(propertyId: number): Promise<ResaleListing[]> {
    return await db.select().from(resaleListings)
      .where(eq(resaleListings.propertyId, propertyId))
      .orderBy(desc(resaleListings.createdAt));
  }

  async getResaleListing(id: number): Promise<ResaleListing | undefined> {
    const [result] = await db.select().from(resaleListings).where(eq(resaleListings.id, id));
    return result;
  }

  async updateResaleListing(id: number, updates: Partial<ResaleListing>): Promise<ResaleListing> {
    const [result] = await db.update(resaleListings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(resaleListings.id, id))
      .returning();
    return result;
  }

  async getAllResaleListings(): Promise<ResaleListing[]> {
    return await db.select().from(resaleListings).orderBy(desc(resaleListings.createdAt));
  }

  async getActiveResaleListings(): Promise<ResaleListing[]> {
    return await db.select().from(resaleListings)
      .where(eq(resaleListings.status, "approved"))
      .orderBy(desc(resaleListings.createdAt));
  }

  async getActiveResaleListingsForReservation(reservationId: number): Promise<ResaleListing[]> {
    return await db.select().from(resaleListings)
      .where(and(
        eq(resaleListings.reservationId, reservationId),
        inArray(resaleListings.status, ["pending_review", "approved"])
      ))
      .orderBy(desc(resaleListings.createdAt));
  }

  async getResaleListingByShareToken(shareToken: string): Promise<ResaleListing | undefined> {
    const [result] = await db.select().from(resaleListings)
      .where(eq(resaleListings.shareToken, shareToken));
    return result;
  }

  async createResaleBid(bid: InsertResaleBid): Promise<ResaleBid> {
    const [result] = await db.insert(resaleBids).values(bid).returning();
    return result;
  }

  async getBidsByListing(listingId: number): Promise<ResaleBid[]> {
    return await db.select().from(resaleBids)
      .where(eq(resaleBids.listingId, listingId))
      .orderBy(desc(resaleBids.amount));
  }

  async getHighestBidForListing(listingId: number): Promise<ResaleBid | undefined> {
    const [result] = await db.select().from(resaleBids)
      .where(and(eq(resaleBids.listingId, listingId), eq(resaleBids.status, "active")))
      .orderBy(desc(resaleBids.amount))
      .limit(1);
    return result;
  }

  async getBidsByUser(userId: number): Promise<ResaleBid[]> {
    return await db.select().from(resaleBids)
      .where(eq(resaleBids.bidderId, userId))
      .orderBy(desc(resaleBids.createdAt));
  }

  async getResaleBid(id: number): Promise<ResaleBid | undefined> {
    const [result] = await db.select().from(resaleBids).where(eq(resaleBids.id, id));
    return result;
  }

  async updateResaleBid(id: number, updates: Partial<ResaleBid>): Promise<ResaleBid> {
    const [result] = await db.update(resaleBids)
      .set(updates)
      .where(eq(resaleBids.id, id))
      .returning();
    return result;
  }

  async createResalePayment(payment: InsertResalePayment): Promise<ResalePayment> {
    const [result] = await db.insert(resalePayments).values(payment).returning();
    return result;
  }

  async getResalePayment(id: number): Promise<ResalePayment | undefined> {
    const [result] = await db.select().from(resalePayments).where(eq(resalePayments.id, id));
    return result;
  }

  async getResalePaymentsByListing(listingId: number): Promise<ResalePayment[]> {
    return await db.select().from(resalePayments)
      .where(eq(resalePayments.listingId, listingId))
      .orderBy(desc(resalePayments.createdAt));
  }

  async getResalePaymentsByBuyer(buyerId: number): Promise<ResalePayment[]> {
    return await db.select().from(resalePayments)
      .where(eq(resalePayments.buyerId, buyerId))
      .orderBy(desc(resalePayments.createdAt));
  }

  async getAllResalePayments(): Promise<ResalePayment[]> {
    return await db.select().from(resalePayments)
      .orderBy(desc(resalePayments.createdAt));
  }

  async updateResalePayment(id: number, updates: Partial<ResalePayment>): Promise<ResalePayment> {
    const [result] = await db.update(resalePayments)
      .set(updates)
      .where(eq(resalePayments.id, id))
      .returning();
    return result;
  }

  async getNextHighestBidForListing(listingId: number, excludeBidderIds: number[]): Promise<ResaleBid | undefined> {
    const conditions = [
      eq(resaleBids.listingId, listingId),
    ];
    if (excludeBidderIds.length > 0) {
      conditions.push(notInArray(resaleBids.bidderId, excludeBidderIds));
    }
    const [result] = await db.select().from(resaleBids)
      .where(and(...conditions))
      .orderBy(desc(resaleBids.amount))
      .limit(1);
    return result;
  }

  async getExpiredAwaitingPaymentListings(): Promise<ResaleListing[]> {
    return await db.select().from(resaleListings)
      .where(
        and(
          eq(resaleListings.status, "awaiting_payment"),
          lt(resaleListings.paymentDeadline, new Date())
        )
      );
  }

  async createResaleAuditLog(log: InsertResaleAuditLog): Promise<ResaleAuditLog> {
    const [result] = await db.insert(resaleAuditLogs).values(log).returning();
    return result;
  }

  async getResaleAuditLogsByListing(listingId: number): Promise<ResaleAuditLog[]> {
    return await db.select().from(resaleAuditLogs)
      .where(eq(resaleAuditLogs.listingId, listingId))
      .orderBy(desc(resaleAuditLogs.createdAt));
  }

  async getResaleAuditLogsByProperty(propertyId: number): Promise<ResaleAuditLog[]> {
    return await db.select().from(resaleAuditLogs)
      .where(eq(resaleAuditLogs.propertyId, propertyId))
      .orderBy(desc(resaleAuditLogs.createdAt));
  }

  async getAllResaleAuditLogs(limit?: number): Promise<ResaleAuditLog[]> {
    const query = db.select().from(resaleAuditLogs).orderBy(desc(resaleAuditLogs.createdAt));
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  // ===========================================================================
  // Developer Portal methods
  // ===========================================================================

  async getPropertiesByDeveloper(developerId: number): Promise<Property[]> {
    return await db.select().from(properties)
      .where(eq(properties.developerId, developerId))
      .orderBy(desc(properties.createdAt));
  }

  async getDevelopers(): Promise<User[]> {
    return await db.select().from(users)
      .where(eq(users.role, "developer"))
      .orderBy(desc(users.createdAt));
  }

  async createProjectMilestone(milestone: InsertProjectMilestone): Promise<ProjectMilestone> {
    const [result] = await db.insert(projectMilestones).values(milestone).returning();
    return result;
  }

  async getMilestonesByProperty(propertyId: number): Promise<ProjectMilestone[]> {
    return await db.select().from(projectMilestones)
      .where(eq(projectMilestones.propertyId, propertyId))
      .orderBy(projectMilestones.sortOrder, projectMilestones.id);
  }

  async getMilestone(id: number): Promise<ProjectMilestone | undefined> {
    const [result] = await db.select().from(projectMilestones).where(eq(projectMilestones.id, id));
    return result;
  }

  async updateMilestone(id: number, updates: Partial<ProjectMilestone>): Promise<ProjectMilestone> {
    const [result] = await db.update(projectMilestones)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(projectMilestones.id, id))
      .returning();
    return result;
  }

  async reorderMilestones(propertyId: number, items: { id: number; sortOrder: number }[]): Promise<ProjectMilestone[]> {
    if (items.length === 0) {
      return await this.getMilestonesByProperty(propertyId);
    }
    const ids = items.map(i => i.id);
    const caseChunks = sql.join(
      items.map(i => sql`WHEN ${projectMilestones.id} = ${i.id} THEN ${i.sortOrder}`),
      sql.raw(" "),
    );
    await db.update(projectMilestones)
      .set({
        sortOrder: sql`CASE ${caseChunks} ELSE ${projectMilestones.sortOrder} END`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(projectMilestones.propertyId, propertyId),
        inArray(projectMilestones.id, ids),
      ));
    return await this.getMilestonesByProperty(propertyId);
  }

  async deleteMilestone(id: number): Promise<void> {
    await db.delete(projectMilestones).where(eq(projectMilestones.id, id));
  }

  async createProjectUpdate(update: InsertProjectUpdate, recipientCount: number): Promise<ProjectUpdate> {
    const [result] = await db.insert(projectUpdates)
      .values({ ...update, recipientCount })
      .returning();
    return result;
  }

  async getProjectUpdatesByProperty(propertyId: number): Promise<ProjectUpdate[]> {
    return await db.select().from(projectUpdates)
      .where(eq(projectUpdates.propertyId, propertyId))
      .orderBy(desc(projectUpdates.sentAt));
  }

  async getProjectUpdatesByDeveloper(developerId: number): Promise<ProjectUpdate[]> {
    return await db.select().from(projectUpdates)
      .where(eq(projectUpdates.authorUserId, developerId))
      .orderBy(desc(projectUpdates.sentAt));
  }

  async upsertDeveloperInvestorNote(note: InsertDeveloperInvestorNote): Promise<DeveloperInvestorNote> {
    const existing = await this.getDeveloperInvestorNote(
      note.propertyId,
      note.developerUserId,
      note.investorUserId
    );
    if (existing) {
      const [result] = await db.update(developerInvestorNotes)
        .set({ notes: note.notes ?? "", updatedAt: new Date() })
        .where(eq(developerInvestorNotes.id, existing.id))
        .returning();
      return result;
    }
    const [result] = await db.insert(developerInvestorNotes).values(note).returning();
    return result;
  }

  async getDeveloperInvestorNote(propertyId: number, developerUserId: number, investorUserId: number): Promise<DeveloperInvestorNote | undefined> {
    const [result] = await db.select().from(developerInvestorNotes)
      .where(and(
        eq(developerInvestorNotes.propertyId, propertyId),
        eq(developerInvestorNotes.developerUserId, developerUserId),
        eq(developerInvestorNotes.investorUserId, investorUserId),
      ));
    return result;
  }

  // Developer CRM leads
  async createDeveloperLead(lead: InsertDeveloperLead): Promise<DeveloperLead> {
    const [result] = await db.insert(developerLeads).values(lead).returning();
    return result;
  }

  async getDeveloperLeadsByProperty(propertyId: number): Promise<DeveloperLead[]> {
    return await db.select().from(developerLeads)
      .where(eq(developerLeads.propertyId, propertyId))
      .orderBy(desc(developerLeads.createdAt));
  }

  async getDeveloperLead(id: number): Promise<DeveloperLead | undefined> {
    const [result] = await db.select().from(developerLeads).where(eq(developerLeads.id, id));
    return result;
  }

  async updateDeveloperLead(id: number, updates: Partial<DeveloperLead>): Promise<DeveloperLead> {
    const [result] = await db.update(developerLeads)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(developerLeads.id, id))
      .returning();
    return result;
  }

  async deleteDeveloperLead(id: number): Promise<void> {
    await db.delete(developerLeads).where(eq(developerLeads.id, id));
  }

  // ===========================================================================
  // Developer subscription / team
  // ===========================================================================

  async getDeveloperOwnerId(userId: number): Promise<number> {
    const u = await this.getUser(userId);
    if (!u) return userId;
    return u.parentDeveloperId ?? userId;
  }

  async getTeamMembersByDeveloper(developerId: number): Promise<User[]> {
    return await db.select().from(users)
      .where(eq(users.parentDeveloperId, developerId))
      .orderBy(desc(users.createdAt));
  }

  async countActiveProjectsForDeveloper(developerId: number): Promise<number> {
    const rows = await db.select({ id: properties.id }).from(properties).where(and(
      eq(properties.developerId, developerId),
      inArray(properties.projectStatus, ["draft", "pending_approval", "live"]),
    ));
    return rows.length;
  }

  async countDistinctInvestorsForDeveloper(developerId: number): Promise<number> {
    const projects = await this.getPropertiesByDeveloper(developerId);
    if (projects.length === 0) return 0;
    const propertyIds = projects.map(p => p.id);
    const rows = await db.select({
      email: investmentReservations.email,
    }).from(investmentReservations).where(and(
      inArray(investmentReservations.propertyId, propertyIds),
      eq(investmentReservations.status, "converted_to_investment"),
    ));
    const distinct = new Set(rows.map(r => (r.email || "").toLowerCase()).filter(Boolean));
    return distinct.size;
  }

  async countUpdatesThisMonthForDeveloper(developerId: number): Promise<number> {
    const projects = await this.getPropertiesByDeveloper(developerId);
    if (projects.length === 0) return 0;
    const propertyIds = projects.map(p => p.id);
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const rows = await db.select({ id: projectUpdates.id }).from(projectUpdates).where(and(
      inArray(projectUpdates.propertyId, propertyIds),
      gte(projectUpdates.sentAt, startOfMonth),
    ));
    return rows.length;
  }

  // ===========================================================================
  // Developer team invites
  // ===========================================================================

  async createDeveloperTeamInvite(invite: InsertDeveloperTeamInvite): Promise<DeveloperTeamInvite> {
    const [result] = await db.insert(developerTeamInvites).values(invite).returning();
    return result;
  }

  async getDeveloperTeamInvitesByDeveloper(developerId: number): Promise<DeveloperTeamInvite[]> {
    return await db.select().from(developerTeamInvites)
      .where(eq(developerTeamInvites.developerId, developerId))
      .orderBy(desc(developerTeamInvites.createdAt));
  }

  async getDeveloperTeamInviteByToken(token: string): Promise<DeveloperTeamInvite | undefined> {
    const [result] = await db.select().from(developerTeamInvites)
      .where(eq(developerTeamInvites.token, token));
    return result;
  }

  async updateDeveloperTeamInvite(id: number, updates: Partial<DeveloperTeamInvite>): Promise<DeveloperTeamInvite> {
    const [result] = await db.update(developerTeamInvites)
      .set(updates)
      .where(eq(developerTeamInvites.id, id))
      .returning();
    return result;
  }
}

export const storage = new DatabaseStorage();
