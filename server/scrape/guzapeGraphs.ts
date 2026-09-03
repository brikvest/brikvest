import { promises as fs } from 'fs';
import path from 'path';

export interface ChartData {
  labels: number[];
  values: number[];
}

export interface HistoricalPricePoint {
  period: string;
  price: string;
  priceValue: number;
  change: string;
  changeValue: number;
}

export interface GuzapeGraphData {
  priceChart: ChartData;
  indexChart: ChartData;
  historicalPrices: {
    lastMonth: {
      price: string;
      priceValue: number;
      change: string;
      changeValue: number;
    };
    sixMonths: HistoricalPricePoint;
    oneYear: HistoricalPricePoint;
    twoYears: HistoricalPricePoint;
  };
  scrapedAt: string;
}

export async function extractGraphDataFromHtml(html: string): Promise<GuzapeGraphData> {
  // Extract the chart data from the HTML
  // Looking for: renderGlobalChart([years...], [values...], 'propertyChart')
  // Pattern matches: numbers, decimals, scientific notation (E/e), negative numbers, commas, whitespace
  
  const priceChartRegex = /renderGlobalChart\(\[([\d,\s.eE+-]+)\],\s*\[([\d,\s.eE+-]+)\]\s*,\s*['"]propertyChart['"]\)/i;
  const indexChartRegex = /renderGlobalChart\(\[([\d,\s.eE+-]+)\],\s*\[([\d,\s.eE+-]+)\]\s*,\s*['"]indexChart['"]\)/i;
  
  const priceMatch = html.match(priceChartRegex);
  const indexMatch = html.match(indexChartRegex);
  
  if (!priceMatch || !indexMatch) {
    throw new Error('Could not find chart data in HTML. The page structure may have changed.');
  }
  
  // Parse the data - handles scientific notation, decimals, negative numbers, and formatted strings
  const parseArray = (str: string): number[] => {
    return str.split(',').map(v => {
      let trimmed = v.trim();
      
      // Try parsing as-is first (handles current scientific notation format)
      let parsed = parseFloat(trimmed);
      
      // If NaN, try stripping currency symbols, commas, and percentage signs
      if (isNaN(parsed)) {
        // Remove currency symbols (₦, $, €, £, etc.), commas, percentage signs, and quotes
        const normalized = trimmed
          .replace(/['"\₦\$\€\£\¥\₹]/g, '')  // Remove currency symbols and quotes
          .replace(/,/g, '')                  // Remove thousands separators
          .replace(/%/g, '');                 // Remove percentage signs
        
        parsed = parseFloat(normalized);
      }
      
      if (isNaN(parsed)) {
        throw new Error(`Invalid number in chart data: "${trimmed}". Unable to parse as number.`);
      }
      
      return parsed;
    });
  };
  
  const priceLabels = parseArray(priceMatch[1]);
  const priceValues = parseArray(priceMatch[2]);
  const indexLabels = parseArray(indexMatch[1]);
  const indexValues = parseArray(indexMatch[2]);
  
  // Extract historical price data
  const historicalPrices = extractHistoricalPrices(html);
  
  return {
    priceChart: {
      labels: priceLabels,
      values: priceValues
    },
    indexChart: {
      labels: indexLabels,
      values: indexValues
    },
    historicalPrices,
    scrapedAt: new Date().toISOString()
  };
}

function extractHistoricalPrices(html: string) {
  // Extract last month average price (handle commas in numbers)
  const lastMonthPriceRegex = /Average Price last month[\s\S]*?<h2>NGN\s*<b>([\d.,]+)<\/b><\/h2>/i;
  // Note: PropertyPro has a typo "mouth" instead of "month" on their site
  const lastMonthChangeRegex = /Price Change in last mouth[\s\S]*?<h2[^>]*>[\s\S]*?NGN\s*<b>([\d.,]+)<\/b>[\s\S]*?<span[^>]*>([\d.,]+)\s*%/i;
  
  // Extract 6 months ago data
  const sixMonthsRegex = /6 Months Ago[\s\S]*?<h5><span>NGN<\/span>\s*([\d.]+\s*million)<\/h5>[\s\S]*?<span[^>]*>([\d.]+)\s*%/i;
  
  // Extract 1 year ago data
  const oneYearRegex = /1 year ago[\s\S]*?<h5><span>NGN<\/span>\s*([\d.]+\s*million)<\/h5>[\s\S]*?<span[^>]*>([\d.]+)\s*%/i;
  
  // Extract 2 years ago data
  const twoYearsRegex = /2 Years Ago[\s\S]*?<h5><span>NGN<\/span>\s*([\d.]+\s*million)<\/h5>[\s\S]*?<span[^>]*>([\d.]+)\s*%/i;
  
  const lastMonthPriceMatch = html.match(lastMonthPriceRegex);
  const lastMonthChangeMatch = html.match(lastMonthChangeRegex);
  const sixMonthsMatch = html.match(sixMonthsRegex);
  const oneYearMatch = html.match(oneYearRegex);
  const twoYearsMatch = html.match(twoYearsRegex);
  
  return {
    lastMonth: {
      price: lastMonthPriceMatch ? `NGN ${lastMonthPriceMatch[1]}` : "NGN 0.0",
      priceValue: lastMonthPriceMatch ? parseFloat(lastMonthPriceMatch[1].replace(/,/g, '')) : 0,
      change: lastMonthChangeMatch ? `NGN ${lastMonthChangeMatch[1]}` : "NGN 0.00",
      changeValue: lastMonthChangeMatch ? parseFloat(lastMonthChangeMatch[2].replace(/,/g, '')) : 0
    },
    sixMonths: {
      period: "6 Months Ago",
      price: sixMonthsMatch ? `NGN ${sixMonthsMatch[1]}` : "NGN 0",
      priceValue: sixMonthsMatch ? parseFloat(sixMonthsMatch[1].replace(/[^\d.]/g, '')) : 0,
      change: sixMonthsMatch ? `${sixMonthsMatch[2]}%` : "0%",
      changeValue: sixMonthsMatch ? parseFloat(sixMonthsMatch[2]) : 0
    },
    oneYear: {
      period: "1 Year Ago",
      price: oneYearMatch ? `NGN ${oneYearMatch[1]}` : "NGN 0",
      priceValue: oneYearMatch ? parseFloat(oneYearMatch[1].replace(/[^\d.]/g, '')) : 0,
      change: oneYearMatch ? `${oneYearMatch[2]}%` : "0%",
      changeValue: oneYearMatch ? parseFloat(oneYearMatch[2]) : 0
    },
    twoYears: {
      period: "2 Years Ago",
      price: twoYearsMatch ? `NGN ${twoYearsMatch[1]}` : "NGN 0",
      priceValue: twoYearsMatch ? parseFloat(twoYearsMatch[1].replace(/[^\d.]/g, '')) : 0,
      change: twoYearsMatch ? `${twoYearsMatch[2]}%` : "0%",
      changeValue: twoYearsMatch ? parseFloat(twoYearsMatch[2]) : 0
    }
  };
}

export async function getGraphDataFromFile(): Promise<GuzapeGraphData> {
  const htmlPath = path.resolve(process.cwd(), 'public', 'guzape.html');
  
  try {
    const html = await fs.readFile(htmlPath, 'utf-8');
    return extractGraphDataFromHtml(html);
  } catch (error: any) {
    // Distinguish between file not found and parse errors
    if (error.code === 'ENOENT') {
      throw new Error('HTML file not found. Run the scraper first to fetch Guzape data.');
    }
    
    // Re-throw parse errors with context
    console.error('Error extracting graph data:', error);
    throw new Error(`Failed to extract graph data: ${error.message}`);
  }
}
