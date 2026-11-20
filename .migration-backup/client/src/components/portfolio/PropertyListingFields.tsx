import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCalendarMonthYear } from "@shared/calendar-date";

export interface PropertyListingFieldsProps {
  listedDate: string;
  currentPricePerUnit: string;
  currency: string;
  onListedDateChange: (value: string) => void;
  onCurrentPriceChange: (value: string) => void;
  idPrefix: string;
}

export function PropertyListingFields({
  listedDate,
  currentPricePerUnit,
  currency,
  onListedDateChange,
  onCurrentPriceChange,
  idPrefix,
}: PropertyListingFieldsProps) {
  const listedDateId = `${idPrefix}-listed-date`;
  const currentPriceId = `${idPrefix}-current-price`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={listedDateId}>Listed Date</Label>
        <Input
          id={listedDateId}
          type="month"
          min="0001-01"
          max="9999-12"
          aria-describedby={`${listedDateId}-help`}
          value={listedDate}
          onChange={(event) => onListedDateChange(event.target.value)}
        />
        <p id={`${listedDateId}-help`} className="text-xs text-muted-foreground">Optional. Choose only the month and year.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={currentPriceId}>Current Price per Unit</Label>
        <Input
          id={currentPriceId}
          type="number"
          min={0}
          step={1}
          max={Number.MAX_SAFE_INTEGER}
          aria-describedby={`${currentPriceId}-help`}
          value={currentPricePerUnit}
          onChange={(event) => onCurrentPriceChange(event.target.value)}
          placeholder={currency}
        />
        <p id={`${currentPriceId}-help`} className="text-xs text-muted-foreground">Optional. Per 5 sqm land unit, in {currency}. Used for new reservations when set; otherwise the listed price applies. Does not change existing reservations or valuation history.</p>
      </div>
    </div>
  );
}

export function PropertyListingMetadata({ property, formatCurrency }: {
  property: { listedDate?: string | null; currentPricePerUnit?: number | null; currency: string };
  formatCurrency: (amount: number, currency: string) => string;
}) {
  return (
    <dl className="mt-2 space-y-1 text-sm text-slate-600">
      {property.listedDate && <div>
        <dt className="inline">Listed Date: </dt>
        <dd className="inline"><time dateTime={property.listedDate}>{formatCalendarMonthYear(`${property.listedDate}-01`)}</time></dd>
      </div>}
      {property.currentPricePerUnit != null && <div>
        <dt className="inline">Current Price per Unit: </dt>
        <dd className="inline">{formatCurrency(property.currentPricePerUnit, property.currency)}</dd>
      </div>}
    </dl>
  );
}
