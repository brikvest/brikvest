import { 
  users, 
  properties,
  investmentReservations,
  developerBids,
  investmentGroups,
  groupMembers,
  groupContributions,
  type User, 
  type InsertUser,
  type Property,
  type InsertProperty,
  type InvestmentReservation,
  type InsertInvestmentReservation,
  type DeveloperBid,
  type InsertDeveloperBid,
  type InvestmentGroup,
  type InsertInvestmentGroup,
  type GroupMember,
  type InsertGroupMember,
  type GroupContribution,
  type InsertGroupContribution,
  type JoinGroupData
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Property methods
  getProperties(): Promise<Property[]>;
  getProperty(id: number): Promise<Property | undefined>;
  createProperty(property: InsertProperty): Promise<Property>;
  updatePropertySlots(propertyId: number, reservedUnits: number): Promise<void>;
  
  // Investment reservation methods
  createInvestmentReservation(reservation: InsertInvestmentReservation): Promise<InvestmentReservation>;
  getReservationsByEmail(email: string): Promise<InvestmentReservation[]>;
  getReservationsByProperty(propertyId: number): Promise<InvestmentReservation[]>;
  
  // Developer bid methods
  createDeveloperBid(bid: InsertDeveloperBid): Promise<DeveloperBid>;
  getDeveloperBids(): Promise<DeveloperBid[]>;
  getDeveloperBid(id: number): Promise<DeveloperBid | undefined>;
  
  // Group investment methods
  createInvestmentGroup(group: InsertInvestmentGroup): Promise<InvestmentGroup>;
  getInvestmentGroups(): Promise<InvestmentGroup[]>;
  getInvestmentGroup(id: number): Promise<InvestmentGroup | undefined>;
  getInvestmentGroupByInviteCode(inviteCode: string): Promise<InvestmentGroup | undefined>;
  joinInvestmentGroup(groupId: number, memberData: InsertGroupMember): Promise<GroupMember>;
  getGroupMembers(groupId: number): Promise<GroupMember[]>;
  updateGroupAmount(groupId: number, amount: number): Promise<void>;
  addGroupContribution(contribution: InsertGroupContribution): Promise<GroupContribution>;
  getGroupContributions(groupId: number): Promise<GroupContribution[]>;
  getMemberContributions(memberId: number): Promise<GroupContribution[]>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
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
    return newReservation;
  }

  async getReservationsByEmail(email: string): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.email, email))
      .orderBy(desc(investmentReservations.createdAt));
  }

  async getReservationsByProperty(propertyId: number): Promise<InvestmentReservation[]> {
    return await db
      .select()
      .from(investmentReservations)
      .where(eq(investmentReservations.propertyId, propertyId))
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

  // Group investment methods
  async createInvestmentGroup(groupData: InsertInvestmentGroup): Promise<InvestmentGroup> {
    // Generate unique invite code
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const [newGroup] = await db
      .insert(investmentGroups)
      .values({
        ...groupData,
        inviteCode,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      })
      .returning();

    // Add group leader as first member
    await db
      .insert(groupMembers)
      .values({
        groupId: newGroup.id,
        fullName: groupData.leaderName,
        email: groupData.leaderEmail,
        phone: groupData.leaderPhone,
        pledgedAmount: Math.floor(groupData.targetAmount / groupData.targetUnits), // Leader's share
        isLeader: true
      });

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

  async joinInvestmentGroup(groupId: number, memberData: InsertGroupMember): Promise<GroupMember> {
    const [newMember] = await db
      .insert(groupMembers)
      .values({
        ...memberData,
        groupId
      })
      .returning();
    return newMember;
  }

  async getGroupMembers(groupId: number): Promise<GroupMember[]> {
    return await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(desc(groupMembers.joinedAt));
  }

  async updateGroupAmount(groupId: number, amount: number): Promise<void> {
    await db
      .update(investmentGroups)
      .set({ currentAmount: amount })
      .where(eq(investmentGroups.id, groupId));
  }

  async addGroupContribution(contribution: InsertGroupContribution): Promise<GroupContribution> {
    const [newContribution] = await db
      .insert(groupContributions)
      .values(contribution)
      .returning();

    // Update member's contributed amount
    await db
      .update(groupMembers)
      .set({ 
        contributedAmount: db.raw(`contributed_amount + ${contribution.amount}`)
      })
      .where(eq(groupMembers.id, contribution.memberId));

    // Update group's current amount
    const [group] = await db.select().from(investmentGroups).where(eq(investmentGroups.id, contribution.groupId));
    if (group) {
      await this.updateGroupAmount(contribution.groupId, group.currentAmount + contribution.amount);
    }

    return newContribution;
  }

  async getGroupContributions(groupId: number): Promise<GroupContribution[]> {
    return await db
      .select()
      .from(groupContributions)
      .where(eq(groupContributions.groupId, groupId))
      .orderBy(desc(groupContributions.contributionDate));
  }

  async getMemberContributions(memberId: number): Promise<GroupContribution[]> {
    return await db
      .select()
      .from(groupContributions)
      .where(eq(groupContributions.memberId, memberId))
      .orderBy(desc(groupContributions.contributionDate));
  }
}

export const storage = new DatabaseStorage();
