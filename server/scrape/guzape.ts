import * as cheerio from 'cheerio';
import type { InsertGuzapeListing } from '@shared/schema';

/**
 * LIMITATION: PropertyPro.ng loads property listings dynamically via JavaScript.
 * This Cheerio-based scraper can only parse static HTML, which means it cannot
 * access the actual property data. The fetched HTML only contains navigation/menu
 * items, not real property listings.
 * 
 * Evidence:
 * - Scraper returns menu items like "Buy", "Flats & Apartments For Sale" instead of properties
 * - No price, beds, baths, or property details are present in static HTML
 * - Same limitation exists in the existing market insights scraper (server/scraper.ts)
 * 
 * Solutions:
 * 1. Find an alternative data source that provides server-rendered HTML or JSON
 * 2. Use PropertyPro.ng API if available
 * 3. Request approval for headless browser solution if PropertyPro.ng data is mandatory
 */

// Centralized selectors at the top for easy maintenance
const SELECTORS = {
  // More specific: only match property URLs with numeric IDs (e.g., /property-for-sale/12345-slug)
  propertyLink: 'a[href*="/property-for-sale/"]',
  cardContainer: 'article, .property, .listing, li, .col, .prop, div',
  price: '[class*="price" i], .price',
  area: '[class*="loc" i], [class*="area" i]',
} as const;

// Regex patterns for extraction
const PATTERNS = {
  price: /(?:₦|NGN)[\s\d,.,]+/i, // Match both ₦ symbol and NGN currency code
  beds: /(\d+)\s*(?:bed|beds|bedroom)/i,
  baths: /(\d+)\s*(?:bath|baths|bathroom)/i,
  toilets: /(\d+)\s*(?:toilet|toilets)/i,
} as const;

interface ScrapedListing {
  listingId: string;
  title: string;
  priceNgnRaw: string | null;
  priceNgn: number | null;
  city: string;
  area: string | null;
  beds: number | null;
  baths: number | null;
  toilets: number | null;
  image: string | null;
  detailUrl: string;
}

/**
 * Normalize text: trim and condense whitespace, empty strings to null
 */
function normalizeText(text: string | undefined | null): string | null {
  if (!text) return null;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract digits only from price string
 */
function extractDigits(priceRaw: string | null): number | null {
  if (!priceRaw) return null;
  const digits = priceRaw.replace(/[^\d]/g, '');
  const num = parseInt(digits, 10);
  return isNaN(num) ? null : num;
}

/**
 * Extract number from text using regex pattern
 */
function extractNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match || !match[1]) return null;
  const num = parseInt(match[1], 10);
  return isNaN(num) ? null : num;
}

/**
 * Extract listing ID from PropertyPro.ng URL
 * Example: /property/5-bedroom-detached-duplex-guzape-abuja-1234567 → "1234567"
 */
function extractListingId(url: string): string {
  const parts = url.split('/');
  const lastPart = parts[parts.length - 1] || parts[parts.length - 2];
  
  // Try to extract numeric ID from end of slug
  const numericMatch = lastPart.match(/(\d+)$/);
  if (numericMatch) {
    return numericMatch[1];
  }
  
  // Fallback: use entire last slug segment
  return lastPart || url;
}

/**
 * Make URL absolute
 */
function makeAbsoluteUrl(url: string): string {
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return `https://propertypro.ng${url}`;
  return `https://propertypro.ng/${url}`;
}

/**
 * Scrape a single property card element
 */
function scrapePropertyCard($: cheerio.CheerioAPI, element: any): ScrapedListing | null {
  try {
    const $card = $(element);
    const cardText = $card.text();
    
    // Extract detail URL
    const link = $card.find(SELECTORS.propertyLink).first();
    const relativeUrl = link.attr('href');
    if (!relativeUrl) return null;
    
    const detailUrl = makeAbsoluteUrl(relativeUrl);
    const listingId = extractListingId(relativeUrl);
    
    // Extract title
    const titleEl = link.find('h1, h2, h3, h4, h5, h6').first();
    const title = normalizeText(titleEl.text() || link.text());
    if (!title) return null;
    
    // Extract price
    let priceNgnRaw: string | null = null;
    const priceEl = $card.find(SELECTORS.price).first();
    if (priceEl.length) {
      priceNgnRaw = normalizeText(priceEl.text());
    }
    
    // Fallback: regex search on card text
    if (!priceNgnRaw) {
      const priceMatch = cardText.match(PATTERNS.price);
      if (priceMatch) {
        priceNgnRaw = normalizeText(priceMatch[0]);
      }
    }
    
    const priceNgn = extractDigits(priceNgnRaw);
    
    // Extract area/neighborhood
    const areaEl = $card.find(SELECTORS.area).first();
    const area = normalizeText(areaEl.text());
    
    // Extract beds, baths, toilets from card text
    const beds = extractNumber(cardText, PATTERNS.beds);
    const baths = extractNumber(cardText, PATTERNS.baths);
    const toilets = extractNumber(cardText, PATTERNS.toilets);
    
    // Extract image (prefer data-src for lazy-loaded images)
    const img = $card.find('img').first();
    let image = img.attr('data-src') || img.attr('src') || null;
    if (image && !image.startsWith('http')) {
      image = image.startsWith('/') ? `https://propertypro.ng${image}` : null;
    }
    
    return {
      listingId,
      title,
      priceNgnRaw,
      priceNgn,
      city: 'Abuja',
      area,
      beds,
      baths,
      toilets,
      image,
      detailUrl,
    };
  } catch (error) {
    console.error('Error scraping property card:', error);
    return null;
  }
}

/**
 * Main scraper function
 * @param html Raw HTML from PropertyPro.ng
 * @param limit Optional limit on number of listings to return
 * @returns Array of normalized property listings
 */
export function scrapeGuzapeListings(html: string, limit?: number): InsertGuzapeListing[] {
  const $ = cheerio.load(html);
  const listings: InsertGuzapeListing[] = [];
  const seen = new Set<string>();
  
  // Find all property links
  $(SELECTORS.propertyLink).each((_, linkEl) => {
    const $link = $(linkEl);
    const href = $link.attr('href');
    
    // Skip links without href or without numeric IDs (e.g., /property-for-sale/12345-slug)
    if (!href || !href.match(/property-for-sale\/\d+[-_]/)) return;
    
    // Find the card container that wraps this link
    const $container = $link.closest(SELECTORS.cardContainer);
    if (!$container.length) return;
    
    // Scrape the card
    const listing = scrapePropertyCard($, $container[0]);
    if (!listing) return;
    
    // Deduplicate by listing ID
    if (seen.has(listing.listingId)) return;
    seen.add(listing.listingId);
    
    listings.push(listing);
    
    // Apply limit if specified
    if (limit && listings.length >= limit) {
      return false; // Break the loop
    }
  });
  
  return listings;
}

/**
 * Fetch HTML from PropertyPro.ng with retry logic
 */
export async function fetchGuzapePage(): Promise<string> {
  const url = 'https://propertypro.ng/index/sale/all/abuja/guzape';
  
  // Be polite: delay before request (1-1.5s)
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };
  
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000), // 15s timeout
    });
    
    if (response.status === 429 || response.status === 503) {
      // Retry once after delay
      console.log(`Received ${response.status}, retrying after 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const retryResponse = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      
      if (!retryResponse.ok) {
        throw new Error(`HTTP ${retryResponse.status}: ${retryResponse.statusText}`);
      }
      
      return await retryResponse.text();
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout after 15 seconds');
    }
    throw error;
  }
}
