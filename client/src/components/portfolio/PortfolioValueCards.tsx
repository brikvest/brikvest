import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, ShieldCheck } from "lucide-react";

interface PortfolioValueCardsProps {
  currentValue: number | null;
  invested: number;
  isLoading: boolean;
  isError: boolean;
  investedLoading: boolean;
  investedError: boolean;
  onRetry: () => void;
  isVerified: boolean;
  unclassifiedCount: number;
  formatCurrency: (value: number) => string;
}

export function PortfolioValueCards({
  currentValue,
  invested,
  isLoading,
  isError,
  investedLoading,
  investedError,
  onRetry,
  isVerified,
  unclassifiedCount,
  formatCurrency,
}: PortfolioValueCardsProps) {
  const excludedMessage = `Land value unavailable for ${unclassifiedCount} holding(s); excluded from this total.`;

  const valueContent = isLoading
    ? "Loading…"
    : isError || currentValue === null
      ? "Value unavailable"
      : formatCurrency(currentValue);

  const investedContent = investedLoading
    ? "Loading…"
    : investedError
      ? "Value unavailable"
      : formatCurrency(invested);

  return (
    <>
      <Card
        className="relative overflow-hidden border-0 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg transition-shadow hover:shadow-xl"
        data-testid="card-current-value"
      >
        <CardContent className="relative p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium text-blue-100 sm:text-sm">
                Current Portfolio Value
              </p>
              <p
                className={`break-words text-xl font-bold leading-tight sm:text-2xl xl:text-3xl ${
                  !isVerified ? "select-none blur-md" : ""
                }`}
              >
                {valueContent}
              </p>
              <p className="mt-1 text-xs text-blue-100">
                Based on latest recorded valuations
              </p>
              {unclassifiedCount > 0 && (
                <p className="mt-1 text-xs text-blue-100">{excludedMessage}</p>
              )}
              {isError && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onRetry}
                  className="mt-3 h-8 bg-white/15 text-white hover:bg-white/25"
                >
                  Retry
                </Button>
              )}
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:h-12 sm:w-12">
              <DollarSign className="h-5 w-5 text-white sm:h-6 sm:w-6" />
            </div>
          </div>
          {!isVerified && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-600/60 backdrop-blur-[2px]">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card
        className="relative border-0 bg-white shadow-lg transition-shadow hover:shadow-xl"
        data-testid="card-total-invested"
      >
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium text-slate-600 sm:text-sm">
                Amount Invested
              </p>
              <p
                className={`break-words text-xl font-bold leading-tight text-slate-900 sm:text-2xl xl:text-3xl ${
                  !isVerified ? "select-none blur-md" : ""
                }`}
              >
                {investedContent}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Land cost only · acquisition fees excluded
              </p>
              {unclassifiedCount > 0 && (
                <p className="mt-1 text-xs text-slate-500">{excludedMessage}</p>
              )}
              {investedError && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="mt-3 h-8"
                >
                  Retry
                </Button>
              )}
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 sm:h-12 sm:w-12">
              <DollarSign className="h-5 w-5 text-amber-600 sm:h-6 sm:w-6" />
            </div>
          </div>
          {!isVerified && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
              <ShieldCheck className="h-6 w-6 text-slate-400" />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default PortfolioValueCards;
