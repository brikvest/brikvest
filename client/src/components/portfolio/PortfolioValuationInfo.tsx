import { useId } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type PortfolioValuationInfoProps = {
  metric: "land" | "current";
};

const valuationCopy = {
  land: {
    trigger: "About Land Valuation",
    heading: "Land Valuation",
    definition:
      "The latest recorded raw land valuation, multiplied by your owned units and divided by the property's total units. Acquisition fees are excluded.",
  },
  current: {
    trigger: "About Current Value",
    heading: "Current Value",
    definition:
      "Your recorded purchase basis, adjusted by the change in investor-basis property valuations since purchase.",
  },
} as const;

export function PortfolioValuationInfo({
  metric,
}: PortfolioValuationInfoProps) {
  const copy = valuationCopy[metric];
  const headingId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={copy.trigger}
          className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Info aria-hidden="true" className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-labelledby={headingId}
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-lg border-border bg-popover p-4 shadow-lg"
      >
        <div className="space-y-1">
          <h2 id={headingId} className="text-sm font-semibold leading-5 text-popover-foreground">
            {copy.heading}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {copy.definition}
          </p>
        </div>
        <div className="space-y-1 border-t border-border pt-3">
          <h3 className="text-sm font-semibold leading-5 text-popover-foreground">
            {metric === "land" ? "Current Value" : "Land Valuation"}
          </h3>
          <p className="text-sm leading-5 text-muted-foreground">
            {metric === "land"
              ? valuationCopy.current.definition
              : valuationCopy.land.definition}
          </p>
        </div>
        <p className="border-t border-border pt-3 text-xs leading-4 text-muted-foreground">
          They can differ because raw-land and investor-basis valuations use
          different starting values and cost assumptions. Neither is a
          guaranteed selling price.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export default PortfolioValuationInfo;
