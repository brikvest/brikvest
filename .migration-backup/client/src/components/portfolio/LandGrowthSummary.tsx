import type { OwnedLandGrowth } from "@/lib/portfolio-performance";

type LandGrowthSummaryProps = {
  growth: OwnedLandGrowth | null;
  currentLandValue: number | null;
  formatCurrency: (value: number) => string;
};

function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function elapsedPeriod(start: string, end: string) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const startDate = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay));

  let months = (endYear - startYear) * 12 + endMonth - startMonth;
  if (endDay < startDay) months -= 1;

  if (months > 0) return `${months} complete ${months === 1 ? "month" : "months"}`;

  const days = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000));
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function LandGrowthSummary({
  growth,
  currentLandValue,
  formatCurrency,
}: LandGrowthSummaryProps) {
  const latestValue = growth?.currentLandValue ?? currentLandValue;

  if (!growth) {
    return (
      <section
        data-testid="land-growth-summary"
        className="rounded-xl border border-border bg-muted/40 p-4 sm:p-5"
        aria-label="Raw land value growth"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Land growth since purchase</h3>
            <p role="status" className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              Growth needs complete ownership details and raw land valuations at purchase and now.
              We won’t estimate a percentage from missing records.
            </p>
          </div>
          {latestValue !== null && (
            <div
              data-testid="owned-land-valuation-latest"
              className="shrink-0 border-l-2 border-primary/30 pl-3"
            >
              <p className="text-xs font-medium text-muted-foreground">Latest value of your shares</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {formatCurrency(latestValue)}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  }

  const isIncrease = growth.changeAmount > 0;
  const isDecrease = growth.changeAmount < 0;
  const direction = isIncrease ? "increase" : isDecrease ? "decrease" : "unchanged";
  const accent = isIncrease
    ? "text-emerald-700"
    : isDecrease
      ? "text-rose-700"
      : "text-muted-foreground";
  const percentPrefix = isIncrease ? "+" : isDecrease ? "−" : "";
  const amountPrefix = isIncrease ? "+" : isDecrease ? "−" : "";
  const multiplePurchaseDates = growth.firstPurchaseDate !== growth.lastPurchaseDate;
  const periodLabel = multiplePurchaseDates
    ? "Multiple purchases"
    : elapsedPeriod(growth.firstPurchaseDate, growth.latestValuationDate);

  return (
    <section
      data-testid="land-growth-summary"
      className="rounded-xl border border-border bg-muted/40 p-4 sm:p-5"
      aria-label="Raw land value growth"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-foreground">Land growth since purchase</h3>
            <span className="text-xs text-muted-foreground">your owned shares</span>
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {multiplePurchaseDates
              ? `Each purchase is compared with its own raw land value. Purchases ${formatDate(growth.firstPurchaseDate)}–${formatDate(growth.lastPurchaseDate)}; latest valuation ${formatDate(growth.latestValuationDate)}.`
              : growth.latestValuationDate < growth.firstPurchaseDate
                ? `No newer valuation recorded · Purchased ${formatDate(growth.firstPurchaseDate)}`
                : `${periodLabel} · ${formatDate(growth.firstPurchaseDate)} to ${formatDate(growth.latestValuationDate)}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4 sm:gap-5">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Change</p>
            <p
              data-testid="land-growth-percentage"
              className={`mt-1 text-2xl font-semibold leading-none tabular-nums sm:text-3xl ${accent}`}
              aria-label={`${direction} ${Math.abs(growth.changePercent).toFixed(2)} percent`}
            >
              {percentPrefix}{Math.abs(growth.changePercent).toFixed(2)}%
            </p>
            <p className={`mt-1 text-xs font-medium tabular-nums ${accent}`}>
              {amountPrefix}{formatCurrency(Math.abs(growth.changeAmount))}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:gap-6">
        <div data-testid="land-growth-at-purchase">
          <p className="text-xs font-medium text-muted-foreground">
            Raw land value at purchase
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
            {formatCurrency(growth.purchaseLandValue)}
          </p>
        </div>
        <div data-testid="owned-land-valuation-latest">
          <p className="text-xs font-medium text-muted-foreground">
            Latest raw land value · {formatDate(growth.latestValuationDate)}
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
            {formatCurrency(latestValue ?? growth.currentLandValue)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-4 text-muted-foreground">
        Raw land value change only. Fees are excluded, so this is not your profit after fees.
      </p>
    </section>
  );
}

export default LandGrowthSummary;
