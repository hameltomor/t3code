import type { OrchestrationThreadContextStatus } from "@xbetools/contracts";

export type ContextThreshold = "neutral" | "watch" | "warning" | "danger";

export interface ContextStatusDisplay {
  /** "Context 42%" or "Context unknown" or "" */
  label: string;
  threshold: ContextThreshold;
  /** Whether to render the badge at all */
  visible: boolean;
}

export function deriveContextThreshold(percent: number | undefined): ContextThreshold {
  if (percent === undefined) return "neutral";
  if (percent >= 95) return "danger";
  if (percent >= 85) return "warning";
  if (percent >= 70) return "watch";
  return "neutral";
}

export function deriveContextStatusDisplay(
  contextStatus: OrchestrationThreadContextStatus | null,
  sessionActive: boolean,
): ContextStatusDisplay {
  if (!sessionActive || !contextStatus) {
    return { label: "", threshold: "neutral", visible: false };
  }
  const label =
    contextStatus.percent !== undefined
      ? `Context ${Math.round(contextStatus.percent)}%`
      : "Context unknown";
  const threshold = deriveContextThreshold(contextStatus.percent);
  return { label, threshold, visible: true };
}
