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
  type InsertOwnershipCertificate
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, ne, sql, inArray } from "drizzle-orm";

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
  updateUserKycStatus(userId: number, status: string): Promise<void>;
  
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

  async updateUserKycStatus(userId: number, status: string): Promise<void> {
    await db.update(users)
      .set({ 
        kycStatus: status as 'not_started' | 'submitted' | 'approved' | 'rejected',
        kycVerifiedAt: status === 'approved' ? new Date() : undefined,
        updatedAt: new Date() 
      })
      .where(eq(users.id, userId));
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

  // Public properties only (buyer use) - excludes archived properties
  async getPublicProperties(): Promise<Property[]> {
    return await db.select().from(properties)
      .where(ne(properties.status, 'archived'))
      .orderBy(desc(properties.createdAt));
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
      const units = typeof reservation.units === 'string' 
        ? parseFloat(reservation.units) 
        : Number(reservation.units) || 0;
      
      const [updated] = await db
        .update(investmentReservations)
        .set({ status: 'cancelled' })
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
}

export const storage = new DatabaseStorage();
