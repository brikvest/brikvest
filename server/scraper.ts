import * as cheerio from 'cheerio';
import type { InsertMarketInsight } from '@shared/schema';

interface ScrapedProperty {
  title: string;
  price: number | null;
  size: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  url: string;
  imageUrl: string | null;
  description: string | null;
  propertyType: string | null;
}

export async function scrapePropertyProAbuja(location: string = 'abuja'): Promise<InsertMarketInsight[]> {
  try {
    const url = `https://propertypro.ng/index/sale/all/${location.toLowerCase()}`;
    console.log(`Scraping PropertyPro.ng for ${location}...`);
    console.log(`URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const properties: InsertMarketInsight[] = [];

    // Find property listings - PropertyPro.ng uses specific class names
    // We'll look for common property listing selectors
    const listingSelectors = [
      '.single-room-sale',
      '.property-list-item',
      '.listing-item',
      'article.listing',
      '.property-item',
      '[data-property-id]'
    ];

    let foundListings = false;
    for (const selector of listingSelectors) {
      const listings = $(selector);
      if (listings.length > 0) {
        foundListings = true;
        console.log(`Found ${listings.length} listings using selector: ${selector}`);
        
        listings.each((_, element) => {
          try {
            const $el = $(element);
            
            // Extract title
            const title = $el.find('h4, h3, .listing-title, .property-title, [class*="title"]').first().text().trim() ||
                         $el.find('a').first().text().trim() ||
                         'Unknown Property';

            // Extract price - look for various price patterns
            const priceText = $el.find('.price, .listing-price, [class*="price"]').first().text().trim() ||
                            $el.find('h4:contains("₦"), span:contains("₦")').first().text().trim();
            const price = extractPrice(priceText);

            // Extract URL
            const relativeUrl = $el.find('a').first().attr('href') || '';
            const propertyUrl = relativeUrl.startsWith('http') ? relativeUrl : `https://propertypro.ng${relativeUrl}`;

            // Extract image
            const imageUrl = $el.find('img').first().attr('src') || 
                           $el.find('img').first().attr('data-src') || 
                           null;

            // Extract property details
            const detailsText = $el.text().toLowerCase();
            const bedrooms = extractNumber(detailsText, /(\d+)\s*bed/i);
            const bathrooms = extractNumber(detailsText, /(\d+)\s*bath/i);
            
            // Extract size - look for sqm or other size indicators
            const sizeMatch = $el.text().match(/(\d+[\d,]*)\s*(sqm|sq\.m|square meters?)/i);
            const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : null;

            // Determine property type from title/description
            const propertyType = determinePropertyType(title + ' ' + detailsText);

            // Extract description if available
            const description = $el.find('.description, .listing-description, p').first().text().trim().slice(0, 500) || null;

            if (title && title !== 'Unknown Property') {
              properties.push({
                source: 'propertypro.ng',
                location: location.charAt(0).toUpperCase() + location.slice(1),
                propertyTitle: title,
                propertyType,
                price,
                pricePerSqm: null,
                size,
                bedrooms,
                bathrooms,
                url: propertyUrl,
                imageUrl,
                description,
              });
            }
          } catch (err) {
            console.error('Error parsing property:', err);
          }
        });

        break; // Stop after finding listings with first successful selector
      }
    }

    if (!foundListings) {
      // If no specific selectors work, try a more generic approach
      console.log('Trying generic article/div approach...');
      $('article, div[class*="property"], div[class*="listing"]').each((_, element) => {
        const $el = $(element);
        const hasPrice = $el.text().includes('₦');
        const hasLink = $el.find('a').length > 0;
        
        if (hasPrice && hasLink) {
          try {
            const title = $el.find('h1, h2, h3, h4, h5, a').first().text().trim();
            const priceText = $el.text().match(/₦[\d,]+/)?.[0] || '';
            const price = extractPrice(priceText);
            const relativeUrl = $el.find('a').first().attr('href') || '';
            const propertyUrl = relativeUrl.startsWith('http') ? relativeUrl : `https://propertypro.ng${relativeUrl}`;
            const imageUrl = $el.find('img').first().attr('src') || null;

            if (title && price) {
              properties.push({
                source: 'propertypro.ng',
                location: location.charAt(0).toUpperCase() + location.slice(1),
                propertyTitle: title,
                propertyType: determinePropertyType(title),
                price,
                pricePerSqm: null,
                size: null,
                bedrooms: null,
                bathrooms: null,
                url: propertyUrl,
                imageUrl,
                description: null,
              });
            }
          } catch (err) {
            console.error('Error in generic parsing:', err);
          }
        }
      });
    }

    console.log(`Successfully scraped ${properties.length} properties from ${location}`);
    return properties.slice(0, 50); // Limit to first 50 properties
  } catch (error) {
    console.error('Error scraping PropertyPro.ng:', error);
    throw error;
  }
}

function extractPrice(priceText: string): number | null {
  if (!priceText) return null;
  
  // Remove currency symbols and clean up
  const cleaned = priceText.replace(/[₦,\s]/g, '');
  
  // Extract numeric value
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  
  const value = parseFloat(match[1]);
  
  // Handle millions/billions notation
  if (priceText.toLowerCase().includes('billion')) {
    return value * 1_000_000_000;
  } else if (priceText.toLowerCase().includes('million') || priceText.toLowerCase().includes('m')) {
    return value * 1_000_000;
  }
  
  return value;
}

function extractNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? parseInt(match[1], 10) : null;
}

function determinePropertyType(text: string): string {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('land') || lowerText.includes('plot')) return 'Land';
  if (lowerText.includes('house') || lowerText.includes('bungalow') || lowerText.includes('duplex')) return 'House';
  if (lowerText.includes('apartment') || lowerText.includes('flat')) return 'Apartment';
  if (lowerText.includes('commercial') || lowerText.includes('office') || lowerText.includes('shop')) return 'Commercial';
  if (lowerText.includes('warehouse')) return 'Warehouse';
  
  return 'Other';
}
