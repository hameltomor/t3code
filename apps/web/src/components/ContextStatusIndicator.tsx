import { Badge } from "./ui/badge";
import type { ContextStatusDisplay, ContextThreshold } from "./contextStatusIndicator.logic";

const THRESHOLD_BADGE_VARIANT = {
  neutral: "outline",
  watch: "info",
  warning: "warning",
  danger: "error",
} as const satisfies Record<ContextThreshold, "outline" | "info" | "warning" | "error">;

export function ContextStatusIndicator({ display }: { display: ContextStatusDisplay }) {
  if (!display.visible) return null;
  return (
    <Badge variant={THRESHOLD_BADGE_VARIANT[display.threshold]} size="sm">
      {display.label}
    </Badge>
  );
}
