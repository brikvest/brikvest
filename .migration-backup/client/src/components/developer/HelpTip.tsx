import { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HelpTipProps {
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Small "?" icon that surfaces a tooltip on hover/focus. Designed to sit
 * inline next to a form label, table header, or section title — used across
 * the developer portal so terms like "Units", "SPV", "Sales lifecycle",
 * etc. are self-explaining during demos.
 */
export default function HelpTip({ children, className = "", side = "top" }: HelpTipProps) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={`inline-flex items-center justify-center text-slate-400 hover:text-blue-600 focus:text-blue-600 focus:outline-none ${className}`}
          onClick={(e) => e.preventDefault()}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

/** Convenience wrapper: a Label + HelpTip on the same row. */
export function LabelWithTip({
  label,
  tip,
  required,
  htmlFor,
  className = "",
}: {
  label: string;
  tip: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 mb-1.5 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-slate-900 leading-none"
      >
        {label}{required && " *"}
      </label>
      <HelpTip>{tip}</HelpTip>
    </div>
  );
}
