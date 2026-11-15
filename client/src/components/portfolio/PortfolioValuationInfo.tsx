import { useId } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type PortfolioValuationInfoProps = {
  metric: "land" | "purchase";
};

const valuationCopy = {
  land: {
    trigger: "About Land Valuation",
    heading: "Land Valuation",
    definition:
      "The recorded raw cost or value of the land, excluding any fees. It shows only your owned shares: the property-wide land amount is scaled by your owned units over the property's total units. Growth compares the latest recorded raw valuation on or before each purchase with the latest raw valuation, for the same owned units. Buying more units does not count as growth. This excludes fees and is not profit after fees.",
  },
  purchase: {
    trigger: "About Purchase Amount",
    heading: "Purchase Amount",
    definition:
      "The full recorded purchase price for your confirmed, currently owned units, including fees. For multiple purchases, the amounts are combined.",
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
            {metric === "land" ? "Purchase Amount" : "Land Valuation"}
          </h3>
          <p className="text-sm leading-5 text-muted-foreground">
            {metric === "land"
              ? valuationCopy.purchase.definition
              : valuationCopy.land.definition}
          </p>
        </div>
        <p className="border-t border-border pt-3 text-xs leading-4 text-muted-foreground">
          The straight Purchase Amount line is the total paid for your currently
          owned units, including fees, held fixed across the graph for comparison.
          Raw land growth compares land value at purchase with the latest land value
          for your owned shares. It excludes fees and is not profit after fees.
          Land Valuation is not a guaranteed selling price.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export default PortfolioValuationInfo;
