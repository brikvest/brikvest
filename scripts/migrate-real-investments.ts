import { db } from "../server/db";
import { investmentReservations, properties } from "../shared/schema";
import fs from 'fs';
import csv from 'csv-parser';
import { eq } from "drizzle-orm";

interface CSVInvestment {
  id: string;
  investor_id: string;
  property_id: string;
  amount: string;
  units: string;
  reference_code: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CSVInvestor {
  id: string;
  email: string;
  full_name: string;
  phone_number: string;
  referral_code: string;
  referred_by: string;
  created_at: string;
  updated_at: string;
}

async function migrateRealInvestments() {
  console.log("🔄 Starting real investment data migration...");

  // First, load investors mapping
  const investorsMap = new Map<string, CSVInvestor>();
  
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream('attached_assets/brikvest_investors_1749251558591.csv')
      .pipe(csv({ separator: ';' }))
      .on('data', (data: CSVInvestor) => {
        investorsMap.set(data.id, data);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`📊 Loaded ${investorsMap.size} investors`);

  // Get the current property (Guzape Heights) ID
  const [currentProperty] = await db.select().from(properties).where(eq(properties.name, "Guzape Heights"));
  
  if (!currentProperty) {
    console.error("❌ Guzape Heights property not found");
    return;
  }

  console.log(`🏠 Found property: ${currentProperty.name} (ID: ${currentProperty.id})`);

  // Clear existing test reservations
  await db.delete(investmentReservations);
  console.log("🗑️ Cleared existing test reservations");

  let totalInvested = 0;
  let investmentCount = 0;

  // Process real investment data
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream('attached_assets/brikvest_investments_1749251558591.csv')
      .pipe(csv({ separator: ';' }))
      .on('data', async (data: CSVInvestment) => {
        try {
          const investor = investorsMap.get(data.investor_id);
          if (!investor) {
            console.warn(`⚠️ Investor not found for investment ${data.id}`);
            return;
          }

          const amount = parseInt(data.amount);
          const units = Math.max(1, Math.floor(amount / currentProperty.minInvestment));

          await db.insert(investmentReservations).values({
            propertyId: currentProperty.id,
            fullName: investor.full_name,
            email: investor.email,
            phone: investor.phone_number,
            units: units,
            referralCode: investor.referral_code || undefined,
            status: data.status,
            createdAt: new Date(data.created_at)
          });

          totalInvested += amount;
          investmentCount++;

          if (investmentCount % 5 === 0) {
            console.log(`📈 Migrated ${investmentCount} investments, total: ₦${totalInvested.toLocaleString()}`);
          }

        } catch (error) {
          console.error(`❌ Error processing investment ${data.id}:`, error);
        }
      })
      .on('end', () => {
        console.log(`✅ Migration complete! ${investmentCount} investments, total: ₦${totalInvested.toLocaleString()}`);
        resolve();
      })
      .on('error', reject);
  });

  // Update property available slots
  const totalUnits = Math.floor(totalInvested / currentProperty.minInvestment);
  const availableSlots = Math.max(0, currentProperty.totalSlots - totalUnits);
  
  await db.update(properties)
    .set({ 
      availableSlots: availableSlots,
      fundingProgress: Math.round(((currentProperty.totalSlots - availableSlots) / currentProperty.totalSlots) * 100)
    })
    .where(eq(properties.id, currentProperty.id));

  console.log(`🎯 Updated property slots: ${availableSlots} available out of ${currentProperty.totalSlots}`);
}

// Run migration
migrateRealInvestments()
  .then(() => {
    console.log("🎉 Real investment data migration completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Migration failed:", error);
    process.exit(1);
  });