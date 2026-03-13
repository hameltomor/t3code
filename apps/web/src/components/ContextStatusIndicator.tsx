import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import type { ContextStatusDisplay, ContextThreshold } from "./contextStatusIndicator.logic";

const FULL_PILL_MODE = import.meta.env.VITE_CONTEXT_STATUS_FULL_PILL === "true";

const THRESHOLD_BADGE_VARIANT = {
  neutral: "outline",
  watch: "info",
  warning: "warning",
  danger: "error",
} as const satisfies Record<ContextThreshold, "outline" | "info" | "warning" | "error">;

function TooltipContent({ display }: { display: ContextStatusDisplay }) {
  return (
    <div className="flex flex-col gap-1 py-0.5">
      <span className="font-medium">{display.sourceLabel}</span>
      {display.tokenDetail && <span>{display.tokenDetail}</span>}
      <Separator orientation="horizontal" />
      <span>
        {display.isStale && display.lastUpdatedLabel
          ? `Stale \u00b7 Updated ${display.lastUpdatedLabel}`
          : "Live"}
      </span>
      {display.compactionCount > 0 && (
        <>
          <span>
            Compacted {display.compactionCount} {display.compactionCount === 1 ? "time" : "times"}
          </span>
          {display.lastCompactedAt && (
            <span className="text-muted-foreground">
              Last: {new Date(display.lastCompactedAt).toLocaleTimeString()}
            </span>
          )}
        </>
      )}
      {display.compactedRecently && (
        <span className="text-success-foreground">Compacted recently</span>
      )}
    </div>
  );
}

function BadgeLabel({ display }: { display: ContextStatusDisplay }) {
  const parts: string[] = [];

  if (FULL_PILL_MODE) {
    const providerPrefix =
      display.sourceLabel.split(" (")[0] ?? display.sourceLabel;
    parts.push(providerPrefix);
  }

  parts.push(display.label);

  if (display.isStale && display.lastUpdatedLabel) {
    parts.push(display.lastUpdatedLabel);
  }

  if (display.compactedRecently && !FULL_PILL_MODE) {
    parts.push("(compacted)");
  }

  return <>{parts.join(" \u00b7 ")}</>;
}

export function ContextStatusIndicator({ display }: { display: ContextStatusDisplay }) {
  if (!display.visible) return null;

  const badge = (
    <Badge variant={THRESHOLD_BADGE_VARIANT[display.threshold]} size="sm">
      <BadgeLabel display={display} />
    </Badge>
  );

  if (!FULL_PILL_MODE) {
    return badge;
  }

  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default">
        {badge}
      </TooltipTrigger>
      <TooltipPopup side="top" sideOffset={6}>
        <TooltipContent display={display} />
      </TooltipPopup>
    </Tooltip>
  );
}
