import fs from 'fs';
import csv from 'csv-parser';
import { db } from '../server/db';
import { properties, investmentReservations, developerBids, investmentGroups, groupMemberships } from '../shared/schema';

interface CSVProperty {
  id: string;
  slug: string;
  name: string;
  description: string;
  developer_notes: string;
  location: string;
  category: string;
  property_price: string;
  price_per_unit: string;
  min_investment: string;
  currency: string;
  roi: string;
  land_size: string;
  exit_strategy: string;
  image: string;
  gallery: string;
  maturity_date: string;
  total_invested: string;
  created_at: string;
  updated_at: string;
}

function parseGallery(galleryString: string): string[] {
  if (!galleryString || galleryString === '{}') return [];
  
  // Remove curly braces and split by comma
  const cleaned = galleryString.replace(/[{}]/g, '');
  return cleaned.split(',').map(url => url.trim()).filter(url => url.length > 0);
}

function calculateSlots(totalValue: number, minInvestment: number): number {
  return Math.floor(totalValue / minInvestment);
}

async function migrateProperties() {
  console.log('Starting property migration...');
  
  const results: CSVProperty[] = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream('../attached_assets/brikvest_properties_1749251141364.csv')
      .pipe(csv({ separator: ';' }))
      .on('data', (data: CSVProperty) => {
        results.push(data);
      })
      .on('end', async () => {
        console.log(`Found ${results.length} properties to migrate`);
        
        try {
          // Clear related data first to avoid foreign key constraints
          await db.delete(groupMemberships);
          console.log('Cleared existing group memberships');
          
          await db.delete(investmentGroups);
          console.log('Cleared existing investment groups');
          
          await db.delete(investmentReservations);
          console.log('Cleared existing investment reservations');
          
          await db.delete(developerBids);
          console.log('Cleared existing developer bids');
          
          await db.delete(properties);
          console.log('Cleared existing properties');
          
          for (const csvProperty of results) {
            const totalValue = parseInt(csvProperty.property_price);
            const minInvestment = parseInt(csvProperty.min_investment);
            const totalSlots = calculateSlots(totalValue, minInvestment);
            const gallery = parseGallery(csvProperty.gallery);
            
            // Calculate available slots based on total invested
            const totalInvested = parseInt(csvProperty.total_invested || '0');
            const fundingProgress = Math.round((totalInvested / totalValue) * 100);
            const investedSlots = Math.floor(totalInvested / minInvestment);
            const availableSlots = totalSlots - investedSlots;
            
            const propertyData = {
              name: csvProperty.name,
              location: csvProperty.location,
              description: csvProperty.description,
              totalValue: totalValue,
              minInvestment: minInvestment,
              projectedReturn: csvProperty.roi.replace('%', ''),
              availableSlots: Math.max(0, availableSlots),
              totalSlots: totalSlots,
              fundingProgress: Math.min(100, fundingProgress),
              imageUrl: csvProperty.image,
              status: 'active',
              badge: csvProperty.category === 'Land' ? 'land' : null,
              developerNotes: csvProperty.developer_notes,
              investmentDetails: `
**Investment Overview:**
- Total Property Value: ₦${totalValue.toLocaleString()}
- Minimum Investment: ₦${minInvestment.toLocaleString()}
- Projected ROI: ${csvProperty.roi}
- Land Size: ${csvProperty.land_size} sqm
- Exit Strategy: ${csvProperty.exit_strategy}
- Maturity Date: ${csvProperty.maturity_date}

**Gallery:**
${gallery.map(url => `- ${url}`).join('\n')}
              `.trim()
            };
            
            await db.insert(properties).values(propertyData);
            console.log(`Migrated: ${csvProperty.name}`);
          }
          
          console.log('Property migration completed successfully!');
          resolve(results);
        } catch (error) {
          console.error('Migration failed:', error);
          reject(error);
        }
      })
      .on('error', reject);
  });
}

// Run migration if this file is executed directly
migrateProperties()
  .then(() => {
    console.log('Migration finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });

export { migrateProperties };