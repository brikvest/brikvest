import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface CurrencyConfig {
  symbol: string;
  name: string;
}

interface ExchangeRates {
  [key: string]: number;
}

interface CurrencyContextType {
  userCurrency: string;
  setUserCurrency: (currency: string) => void;
  exchangeRates: ExchangeRates | null;
  availableCurrencies: Record<string, CurrencyConfig>;
  convertAmount: (amount: number, fromCurrency?: string) => number;
  formatCurrency: (amount: number, currency?: string) => string;
  isLoading: boolean;
}

const CurrencyContext = createContext<CurrencyContextType | null>(null);

// Popular currencies for selection
const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  NGN: '₦',
  AED: 'د.إ',
  KES: 'KSh',
  ZAR: 'R',
  GHS: '₵',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
} as const;

export function CurrencyProvider({ children }: { children: ReactNode }) {
  // Default to NGN (Nigerian Naira) as this is a Nigerian real estate platform
  const [userCurrency, setUserCurrencyState] = useState<string>('NGN');

  // Fetch exchange rates and available currencies
  const { data: ratesData, isLoading } = useQuery({
    queryKey: ['/api/exchange-rates'],
    refetchInterval: 60 * 60 * 1000, // Refetch every hour
  }) as { data?: { rates: ExchangeRates; currencies: Record<string, CurrencyConfig> }; isLoading: boolean };

  // Initialize currency from localStorage only (user must explicitly choose to change from NGN)
  useEffect(() => {
    const savedCurrency = localStorage.getItem('selectedCurrency');
    if (savedCurrency) {
      setUserCurrencyState(savedCurrency);
    }
    // If no saved currency, keep default NGN - don't auto-detect
  }, []);

  const setUserCurrency = (currency: string) => {
    setUserCurrencyState(currency);
    localStorage.setItem('selectedCurrency', currency);
  };

  const convertAmount = (amount: number, fromCurrency: string = 'NGN'): number => {
    // Normalize currency codes to uppercase
    const normalizedFrom = (fromCurrency || 'NGN').toUpperCase().trim();
    const normalizedTo = userCurrency.toUpperCase().trim();
    
    // No conversion needed if same currency or rates not loaded
    if (!ratesData || !ratesData.rates || normalizedFrom === normalizedTo) {
      return amount;
    }

    // Ensure we have valid rates for both currencies
    if (normalizedFrom !== 'USD' && !ratesData.rates[normalizedFrom]) {
      console.warn(`Missing exchange rate for ${normalizedFrom}, returning original amount`);
      return amount;
    }
    if (normalizedTo !== 'USD' && !ratesData.rates[normalizedTo]) {
      console.warn(`Missing exchange rate for ${normalizedTo}, returning original amount`);
      return amount;
    }

    // Convert from source currency to USD first (USD is the base in exchange rates)
    const usdAmount = normalizedFrom === 'USD' ? amount : amount / ratesData.rates[normalizedFrom];
    
    // Convert from USD to target currency
    const convertedAmount = normalizedTo === 'USD' ? usdAmount : usdAmount * ratesData.rates[normalizedTo];
    
    return convertedAmount;
  };

  const formatCurrency = (amount: number, currency?: string): string => {
    const targetCurrency = currency || userCurrency;
    const symbol = CURRENCY_SYMBOLS[targetCurrency as keyof typeof CURRENCY_SYMBOLS] || targetCurrency;
    
    // Format based on currency
    if (targetCurrency === 'JPY') {
      // Japanese Yen doesn't use decimals
      return `${symbol}${Math.round(amount).toLocaleString()}`;
    }
    
    return `${symbol}${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  return (
    <CurrencyContext.Provider
      value={{
        userCurrency,
        setUserCurrency,
        exchangeRates: ratesData?.rates || null,
        availableCurrencies: ratesData?.currencies || {},
        convertAmount,
        formatCurrency,
        isLoading,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}

// Hook to get converted properties
export function useConvertedProperties() {
  const { userCurrency } = useCurrency();
  
  return useQuery({
    queryKey: ['/api/properties-converted', userCurrency],
    queryFn: async () => {
      const data = await apiRequest(`/api/properties-converted?currency=${userCurrency}`, {
        method: 'GET'
      });
      return data;
    },
  });
}