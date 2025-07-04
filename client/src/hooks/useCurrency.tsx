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
  const [userCurrency, setUserCurrencyState] = useState<string>('USD');

  // Fetch exchange rates and available currencies
  const { data: ratesData, isLoading } = useQuery({
    queryKey: ['/api/exchange-rates'],
    refetchInterval: 60 * 60 * 1000, // Refetch every hour
  }) as { data?: { rates: ExchangeRates; currencies: Record<string, CurrencyConfig> }; isLoading: boolean };

  // Detect user's currency based on location
  const { data: detectedCurrency } = useQuery({
    queryKey: ['/api/user-currency'],
    enabled: !localStorage.getItem('selectedCurrency'), // Only detect if no manual selection
  }) as { data?: { currency: string } };

  // Initialize currency from localStorage or detected currency
  useEffect(() => {
    const savedCurrency = localStorage.getItem('selectedCurrency');
    if (savedCurrency) {
      setUserCurrencyState(savedCurrency);
    } else if (detectedCurrency?.currency) {
      setUserCurrencyState(detectedCurrency.currency);
    }
  }, [detectedCurrency]);

  const setUserCurrency = (currency: string) => {
    setUserCurrencyState(currency);
    localStorage.setItem('selectedCurrency', currency);
  };

  const convertAmount = (amount: number, fromCurrency: string = 'USD'): number => {
    if (!ratesData || !ratesData.rates || fromCurrency === userCurrency) {
      return amount;
    }

    // Convert from source currency to USD first
    const usdAmount = fromCurrency === 'USD' ? amount : amount / ratesData.rates[fromCurrency];
    
    // Convert from USD to target currency
    const convertedAmount = userCurrency === 'USD' ? usdAmount : usdAmount * ratesData.rates[userCurrency];
    
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
      const response = await apiRequest(`/api/properties-converted?currency=${userCurrency}`);
      return response.json();
    },
  });
}