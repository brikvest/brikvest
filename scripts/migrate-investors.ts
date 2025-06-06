import fs from 'fs';
import csv from 'csv-parser';
import { db } from '../server/db';
import { users, investmentReservations, properties } from '../shared/schema';
import { eq } from 'drizzle-orm';

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

async function migrateInvestors() {
  console.log('Starting investor migration...');
  
  const investors: CSVInvestor[] = [];
  const investments: CSVInvestment[] = [];
  
  // Read investors CSV
  await new Promise((resolve, reject) => {
    fs.createReadStream('../attached_assets/brikvest_investors_1749251558591.csv')
      .pipe(csv({ separator: ';' }))
      .on('data', (data: CSVInvestor) => {
        investors.push(data);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  
  // Read investments CSV
  await new Promise((resolve, reject) => {
    fs.createReadStream('../attached_assets/brikvest_investments_1749251558591.csv')
      .pipe(csv({ separator: ';' }))
      .on('data', (data: CSVInvestment) => {
        investments.push(data);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  
  console.log(`Found ${investors.length} investors and ${investments.length} investments to migrate`);
  
  try {
    // First, migrate investors as users
    for (const investor of investors) {
      // Extract first and last name from full name
      const nameParts = investor.full_name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      const userData = {
        username: investor.referral_code || investor.email.split('@')[0],
        email: investor.email,
        firstName: firstName,
        lastName: lastName,
        phone: investor.phone_number,
        referralCode: investor.referral_code,
        role: 'investor',
        createdAt: new Date(investor.created_at),
        lastLogin: new Date(investor.created_at),
      };
      
      await db.insert(users).values(userData).onConflictDoNothing();
      console.log(`Migrated investor: ${investor.full_name}`);
    }
    
    // Then migrate investments as reservations
    for (const investment of investments) {
      const investor = investors.find(inv => inv.id === investment.investor_id);
      if (!investor) {
        console.log(`Skipping investment ${investment.id} - investor not found`);
        continue;
      }
      
      // Find the user ID for this investor
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, investor.email))
        .limit(1);
      
      if (!user) {
        console.log(`Skipping investment ${investment.id} - user not found`);
        continue;
      }
      
      // Get the current property ID (we only have one property from the previous migration)
      const [property] = await db
        .select({ id: properties.id })
        .from(properties)
        .limit(1);
      
      if (!property) {
        console.log(`Skipping investment ${investment.id} - no property found`);
        continue;
      }
      
      const reservationData = {
        propertyId: property.id,
        fullName: investor.full_name,
        email: investor.email,
        phone: investor.phone_number,
        units: Math.floor(parseInt(investment.amount) / 11000000), // Convert amount to whole units
        referralCode: investor.referral_code,
        status: investment.status === 'pending' ? 'reserved' : 'confirmed',
        createdAt: new Date(investment.created_at),
      };
      
      await db.insert(investmentReservations).values(reservationData);
      console.log(`Migrated investment: ${investor.full_name} - ₦${parseInt(investment.amount).toLocaleString()}`);
    }
    
    console.log('Investor and investment migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateInvestors()
  .then(() => {
    console.log('Migration finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

export { migrateInvestors };