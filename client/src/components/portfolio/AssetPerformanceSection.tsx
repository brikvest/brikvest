import { useEffect, useState, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AssetPerformanceSectionProps = {
  assets: { id: number; name: string }[];
  renderCharts: (propertyId: number) => ReactNode;
};

export function AssetPerformanceSection({
  assets,
  renderCharts,
}: AssetPerformanceSectionProps) {
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(
    () => assets[0]?.id ?? null,
  );

  useEffect(() => {
    if (assets.length === 0) {
      setSelectedPropertyId(null);
      return;
    }

    if (!assets.some((asset) => asset.id === selectedPropertyId)) {
      setSelectedPropertyId(assets[0].id);
    }
  }, [assets, selectedPropertyId]);

  if (assets.length === 0) return null;

  // Resolve against the current list so a removed selection never renders stale charts.
  const selectedAsset =
    assets.find((asset) => asset.id === selectedPropertyId) ?? assets[0];

  return (
    <section
      aria-label="Performance by asset"
      data-testid="asset-performance-section"
      className="mb-6 sm:mb-8"
    >
      <Card className="overflow-hidden shadow-lg">
        <CardHeader className="gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <CardTitle className="text-lg sm:text-xl">
              Performance by asset
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl leading-relaxed">
              Review Land Valuation for the whole selected property and
              Current Value for your own holdings in it.
            </CardDescription>
          </div>

          <div className="w-full min-w-0 sm:w-72 sm:shrink-0">
            <label
              htmlFor="asset-performance-select"
              className="mb-1.5 block text-sm font-medium text-slate-700"
            >
              Choose an asset
            </label>
            <Select
              value={String(selectedAsset.id)}
              onValueChange={(value) => {
                const nextAsset = assets.find(
                  (asset) => String(asset.id) === value,
                );
                if (nextAsset) setSelectedPropertyId(nextAsset.id);
              }}
            >
              <SelectTrigger
                id="asset-performance-select"
                aria-label="Choose an asset"
                className="h-11 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assets.map((asset) => (
                  <SelectItem key={asset.id} value={String(asset.id)}>
                    <span className="block max-w-[min(70vw,28rem)] truncate">
                      {asset.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6">
          <h3 className="mb-4 break-words text-base font-semibold text-slate-900 sm:text-lg">
            {selectedAsset.name}
          </h3>
          <div
            key={selectedAsset.id}
            data-testid="asset-performance-charts"
            className="min-w-0"
          >
            {renderCharts(selectedAsset.id)}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
