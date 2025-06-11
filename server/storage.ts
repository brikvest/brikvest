import { 
  users, 
  adminUsers,
  properties,
  investmentReservations,
  developerBids,
  investmentGroups,
  groupMemberships,
  type User, 
  type InsertUser,
  type AdminUser,
  type InsertAdminUser,
  type Property,
  type InsertProperty,
  type InvestmentReservation,
  type InsertInvestmentReservation,
  type DeveloperBid,
  type InsertDeveloperBid,
  type InvestmentGroup,
  type InsertInvestmentGroup,
  type GroupMembership,
  type InsertGroupMembership
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

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
  
  // Admin user methods
  getAdminUser(id: number): Promise<AdminUser | undefined>;
  getAdminUserByUsername(username: string): Promise<AdminUser | undefined>;
  createAdminUser(user: InsertAdminUser): Promise<AdminUser>;
  updateAdminUserLastLogin(id: number): Promise<void>;
  
  // Property methods
  getProperties(): Promise<Property[]>;
  getProperty(id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(id: number, property: InsertProperty): Promise<Property>;
  deleteProperty(id: number): Promise<void>;
  updatePropertySlots(propertyId: number, reservedUnits: number): Promise<void>;
  
  // Investment reservation methods
  createInvestmentReservation(reservation: InsertInvestmentReservation): Promise<InvestmentReservation>;
  getReservationsByEmail(email: string): Promise<InvestmentReservation[]>;
  getReservationsByUserId(userId: number): Promise<InvestmentReservation[]>;
  getReservationsByProperty(propertyId: number): Promise<InvestmentReservation[]>;
  getAllReservations(): Promise<InvestmentReservation[]>;
  
  // Developer bid methods
  createDeveloperBid(bid: InsertDeveloperBid): Promise<DeveloperBid>;
  getDeveloperBids(): Promise<DeveloperBid[]>;
  getDeveloperBid(id: number): Promise<DeveloperBid | undefined>;
  
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

  // Property methods
  async getProperties(): Promise<Property[]> {
    return await db.select().from(properties).orderBy(desc(properties.createdAt));
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
    await this.updatePropertySlots(reservation.propertyId, reservation.units);
    
    return newReservation;
  }

  async getReservationsByEmail(email: string): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.email, email))
      .orderBy(desc(investmentReservations.createdAt));
  }

  async getReservationsByUserId(userId: number): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.userId, userId))
      .orderBy(desc(investmentReservations.createdAt));
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

  // Developer bid methods
  async createDeveloperBid(bid: InsertDeveloperBid): Promise<DeveloperBid> {
    const [newBid] = await db
      .insert(developerBids)
      .values(bid)
      .returning();
    return newBid;
  }

  async getDeveloperBids(): Promise<DeveloperBid[]> {
    return await db
      .select()
      .from(developerBids)
      .orderBy(desc(developerBids.createdAt));
  }

  async getDeveloperBid(id: number): Promise<DeveloperBid | undefined> {
    const [bid] = await db.select().from(developerBids).where(eq(developerBids.id, id));
    return bid || undefined;
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
}

export const storage = new DatabaseStorage();
