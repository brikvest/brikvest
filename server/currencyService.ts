interface ExchangeRates {
  [key: string]: number;
}

interface CurrencyConversionResponse {
  rates: ExchangeRates;
  base: string;
  date: string;
}

// Cache for exchange rates - expires after 1 hour
let ratesCache: {
  rates: ExchangeRates;
  timestamp: number;
} | null = null;

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// Popular currencies with their symbols
export const CURRENCY_CONFIG = {
  USD: { symbol: '$', name: 'US Dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  GBP: { symbol: '£', name: 'British Pound' },
  NGN: { symbol: '₦', name: 'Nigerian Naira' },
  KES: { symbol: 'KSh', name: 'Kenyan Shilling' },
  ZAR: { symbol: 'R', name: 'South African Rand' },
  GHS: { symbol: '₵', name: 'Ghanaian Cedi' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar' },
  AUD: { symbol: 'A$', name: 'Australian Dollar' },
  JPY: { symbol: '¥', name: 'Japanese Yen' },
  CNY: { symbol: '¥', name: 'Chinese Yuan' },
  INR: { symbol: '₹', name: 'Indian Rupee' },
} as const;

// Country to currency mapping
export const COUNTRY_CURRENCY_MAP = {
  US: 'USD',
  NG: 'NGN',
  KE: 'KES',
  ZA: 'ZAR',
  GH: 'GHS',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  JP: 'JPY',
  CN: 'CNY',
  IN: 'INR',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
} as const;

export async function getExchangeRates(): Promise<ExchangeRates> {
  // Check if we have valid cached rates
  if (ratesCache && Date.now() - ratesCache.timestamp < CACHE_DURATION) {
    return ratesCache.rates;
  }

  try {
    // Using exchangerate-api.com (free tier: 1500 requests/month)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data: CurrencyConversionResponse = await response.json();
    
    // Cache the rates
    ratesCache = {
      rates: data.rates,
      timestamp: Date.now()
    };
    
    return data.rates;
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    
    // Return fallback rates if API fails
    return {
      USD: 1,
      EUR: 0.85,
      GBP: 0.73,
      NGN: 1650,
      KES: 129,
      ZAR: 18.5,
      GHS: 15.8,
      CAD: 1.35,
      AUD: 1.52,
      JPY: 150,
      CNY: 7.2,
      INR: 83,
    };
  }
}

export function convertCurrency(
  amount: number, 
  fromCurrency: string, 
  toCurrency: string, 
  rates: ExchangeRates
): number {
  if (fromCurrency === toCurrency) {
    return amount;
  }
  
  // Convert from source currency to USD first
  const usdAmount = fromCurrency === 'USD' ? amount : amount / rates[fromCurrency];
  
  // Convert from USD to target currency
  const convertedAmount = toCurrency === 'USD' ? usdAmount : usdAmount * rates[toCurrency];
  
  return convertedAmount;
}

export function formatCurrency(amount: number, currency: string): string {
  const config = CURRENCY_CONFIG[currency as keyof typeof CURRENCY_CONFIG];
  
  if (!config) {
    return `${amount.toFixed(2)} ${currency}`;
  }
  
  // Format based on currency
  if (currency === 'JPY') {
    // Japanese Yen doesn't use decimals
    return `${config.symbol}${Math.round(amount).toLocaleString()}`;
  }
  
  return `${config.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function getCurrencyFromCountry(countryCode: string): string {
  return COUNTRY_CURRENCY_MAP[countryCode as keyof typeof COUNTRY_CURRENCY_MAP] || 'USD';
}

export function detectUserCurrency(req: any): string {
  // Try to get currency from user preferences
  if (req.user?.preferredCurrency) {
    return req.user.preferredCurrency;
  }
  
  // Try to get from user's country
  if (req.user?.country) {
    return getCurrencyFromCountry(req.user.country);
  }
  
  // Try to detect from headers (simplified approach)
  const acceptLanguage = req.headers['accept-language'] || '';
  
  if (acceptLanguage.includes('en-NG') || acceptLanguage.includes('ng')) return 'NGN';
  if (acceptLanguage.includes('en-KE') || acceptLanguage.includes('ke')) return 'KES';
  if (acceptLanguage.includes('en-ZA') || acceptLanguage.includes('za')) return 'ZAR';
  if (acceptLanguage.includes('en-GH') || acceptLanguage.includes('gh')) return 'GHS';
  if (acceptLanguage.includes('en-GB') || acceptLanguage.includes('gb')) return 'GBP';
  if (acceptLanguage.includes('en-CA') || acceptLanguage.includes('ca')) return 'CAD';
  if (acceptLanguage.includes('en-AU') || acceptLanguage.includes('au')) return 'AUD';
  
  // Default to USD
  return 'USD';
}