import type { OrchestrationThreadContextStatus } from "@xbetools/contracts";

export type ContextThreshold = "neutral" | "watch" | "warning" | "danger";

/** Threshold in ms for "compacted recently" (5 minutes). */
export const COMPACTION_RECENCY_THRESHOLD_MS = 5 * 60 * 1000;

export interface ContextStatusDisplay {
  /** "Context 42%" or "Context unknown" or "" */
  label: string;
  threshold: ContextThreshold;
  /** Whether to render the badge at all */
  visible: boolean;
  /** True if lastCompactedAt is within COMPACTION_RECENCY_THRESHOLD_MS of nowMs */
  compactedRecently: boolean;
  /** True if freshness is "stale" */
  isStale: boolean;
  /** Relative time string like "2m ago" when stale, null otherwise */
  lastUpdatedLabel: string | null;
  /** Number of compactions, default 0 */
  compactionCount: number;
  /** ISO string of last compaction, or null */
  lastCompactedAt: string | null;
  /** Human-readable source label, e.g. "Codex (native)" */
  sourceLabel: string;
  /** Token detail like "5,000 / 128,000 tokens" or null */
  tokenDetail: string | null;
}

export function deriveContextThreshold(percent: number | undefined): ContextThreshold {
  if (percent === undefined) return "neutral";
  if (percent >= 95) return "danger";
  if (percent >= 85) return "warning";
  if (percent >= 70) return "watch";
  return "neutral";
}

const INVISIBLE_DISPLAY: ContextStatusDisplay = {
  label: "",
  threshold: "neutral",
  visible: false,
  compactedRecently: false,
  isStale: false,
  lastUpdatedLabel: null,
  compactionCount: 0,
  lastCompactedAt: null,
  sourceLabel: "",
  tokenDetail: null,
};

/**
 * Format a number with locale-style commas (e.g. 5000 -> "5,000").
 */
function formatTokenCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Map provider + support to a human-readable label.
 */
function deriveSourceLabel(
  provider: OrchestrationThreadContextStatus["provider"],
  support: OrchestrationThreadContextStatus["support"],
): string {
  const providerLabel =
    provider === "codex" ? "Codex" : provider === "claudeCode" ? "Claude Code" : "Gemini";
  const supportLabel =
    support === "native"
      ? "native"
      : support === "derived-live"
        ? "derived"
        : support === "derived-on-demand"
          ? "on-demand"
          : "unsupported";
  return `${providerLabel} (${supportLabel})`;
}

/**
 * Format relative time from a past timestamp to nowMs.
 * Returns strings like "2m ago", "1h ago".
 */
function formatRelativeTime(pastIso: string, nowMs: number): string {
  const diffMs = nowMs - new Date(pastIso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "<1m ago";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  return `${diffHours}h ago`;
}

export function deriveContextStatusDisplay(
  contextStatus: OrchestrationThreadContextStatus | null,
  sessionActive: boolean,
  nowMs: number = Date.now(),
): ContextStatusDisplay {
  if (!sessionActive || !contextStatus) {
    return INVISIBLE_DISPLAY;
  }

  const label =
    contextStatus.percent !== undefined
      ? `Context ${Math.round(contextStatus.percent)}%`
      : "Context unknown";
  const threshold = deriveContextThreshold(contextStatus.percent);

  // Compaction recency
  const lastCompactedAtIso = contextStatus.lastCompactedAt ?? null;
  const compactedRecently =
    lastCompactedAtIso !== null &&
    nowMs - new Date(lastCompactedAtIso).getTime() < COMPACTION_RECENCY_THRESHOLD_MS;

  // Stale freshness
  const isStale = contextStatus.freshness === "stale";
  const lastUpdatedLabel =
    isStale && contextStatus.measuredAt
      ? formatRelativeTime(contextStatus.measuredAt, nowMs)
      : null;

  // Source label
  const sourceLabel = deriveSourceLabel(contextStatus.provider, contextStatus.support);

  // Token detail
  let tokenDetail: string | null = null;
  if (contextStatus.tokenUsage?.totalTokens !== undefined) {
    const total = formatTokenCount(contextStatus.tokenUsage.totalTokens);
    if (contextStatus.contextWindowLimit !== undefined) {
      const limit = formatTokenCount(contextStatus.contextWindowLimit);
      tokenDetail = `${total} / ${limit} tokens`;
    } else {
      tokenDetail = `${total} tokens`;
    }
  }

  return {
    label,
    threshold,
    visible: true,
    compactedRecently,
    isStale,
    lastUpdatedLabel,
    compactionCount: contextStatus.compactionCount ?? 0,
    lastCompactedAt: lastCompactedAtIso,
    sourceLabel,
    tokenDetail,
  };
}
