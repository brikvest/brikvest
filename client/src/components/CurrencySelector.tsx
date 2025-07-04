import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";

const POPULAR_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', flag: '🇦🇪' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', flag: '🇬🇭' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
];

interface CurrencySelectorProps {
  className?: string;
  compact?: boolean;
}

export function CurrencySelector({ className = "", compact = false }: CurrencySelectorProps) {
  const { userCurrency, setUserCurrency, isLoading } = useCurrency();

  const currentCurrency = POPULAR_CURRENCIES.find(curr => curr.code === userCurrency);

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Globe className="h-4 w-4 text-slate-400" />
        <div className="h-9 w-20 bg-slate-200 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {!compact && <Globe className="h-4 w-4 text-slate-600" />}
      
      <Select value={userCurrency} onValueChange={setUserCurrency}>
        <SelectTrigger className={compact ? "w-auto h-8 text-sm" : "w-auto min-w-[140px]"}>
          <SelectValue>
            {currentCurrency ? (
              <div className="flex items-center gap-2">
                <span className="text-lg">{currentCurrency.flag}</span>
                <span className="font-medium">{currentCurrency.symbol}</span>
                {!compact && <span className="text-sm text-slate-600">{currentCurrency.code}</span>}
              </div>
            ) : (
              userCurrency
            )}
          </SelectValue>
        </SelectTrigger>
        
        <SelectContent>
          {POPULAR_CURRENCIES.map((currency) => (
            <SelectItem key={currency.code} value={currency.code}>
              <div className="flex items-center gap-3">
                <span className="text-lg">{currency.flag}</span>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{currency.symbol}</span>
                    <span className="font-medium">{currency.code}</span>
                  </div>
                  <span className="text-xs text-slate-500">{currency.name}</span>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}