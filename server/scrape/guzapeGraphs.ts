import { promises as fs } from 'fs';
import path from 'path';

export interface ChartData {
  labels: number[];
  values: number[];
}

export interface GuzapeGraphData {
  priceChart: ChartData;
  indexChart: ChartData;
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
  
  return {
    priceChart: {
      labels: priceLabels,
      values: priceValues
    },
    indexChart: {
      labels: indexLabels,
      values: indexValues
    },
    scrapedAt: new Date().toISOString()
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
