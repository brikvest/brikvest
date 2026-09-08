import type { Property } from "@shared/schema";
import {
  calculateUnitCostTotal,
  shouldShowUnitCostBreakdown,
  UNIT_COST_COMPONENTS,
} from "@shared/property-cost-breakdown";

type UnitCostBreakdownPanelProps = {
  property: Property;
  formatAmount: (amount: number) => string;
};

export function UnitCostBreakdownPanel({
  property,
  formatAmount,
}: UnitCostBreakdownPanelProps) {
  if (!shouldShowUnitCostBreakdown(property)) return null;

  return (
    <section
      className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 sm:p-6"
      data-testid="customer-unit-cost-breakdown"
    >
      <h3 className="text-lg sm:text-xl font-semibold mb-1">What One Unit Costs</h3>
      <p className="mb-4 text-sm text-slate-600">A transparent breakdown of the per-unit cost.</p>
      <dl className="space-y-3">
        {UNIT_COST_COMPONENTS.map(({ key, label }) => (
          <div className="flex items-center justify-between gap-4" key={key}>
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium">{formatAmount(Number(property[key] ?? 0))}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 border-t border-blue-200 pt-3 text-base font-semibold">
          <dt>Total per Unit</dt>
          <dd>{formatAmount(calculateUnitCostTotal(property))}</dd>
        </div>
      </dl>
    </section>
  );
}