/**
 * Pure computation function that converts NormalizedTokenUsage + model info
 * into an OrchestrationThreadContextStatus with correct status levels.
 *
 * Status levels:
 * - "ok": usage < 75%
 * - "watch": usage >= 75% and < 95%
 * - "near-limit": usage >= 95%
 * - "compacted": token count dropped significantly from previous
 * - "unknown": percent cannot be computed (no context window limit)
 *
 * @module contextStatusComputation
 */
import type {
  ContextStatusLevel,
  ContextStatusSource,
  ContextStatusSupport,
  NormalizedTokenUsage,
  OrchestrationThreadContextStatus,
  ProviderKind,
} from "@xbetools/contracts";
import { getContextWindowLimit } from "@xbetools/shared/model";

export interface ComputeContextStatusInput {
  readonly provider: ProviderKind;
  readonly model: string | null;
  readonly usage: NormalizedTokenUsage;
  readonly support: ContextStatusSupport;
  readonly source: ContextStatusSource;
  readonly measuredAt: string;
  readonly previousStatus?: OrchestrationThreadContextStatus | null;
}

export function computeContextStatus(
  input: ComputeContextStatusInput,
): OrchestrationThreadContextStatus {
  const limit = getContextWindowLimit(input.model, input.provider);
  const maxInputTokens = limit?.maxInputTokens ?? null;
  const percent =
    maxInputTokens && input.usage.totalTokens
      ? (input.usage.totalTokens / maxInputTokens) * 100
      : undefined;

  // Detect compaction: explicit compact-boundary signal, or heuristic fallback (>20% token drop)
  const isCompacted =
    input.source === "compact-boundary" ||
    (input.previousStatus?.tokenUsage?.totalTokens !== undefined &&
      input.usage.totalTokens < input.previousStatus.tokenUsage.totalTokens * 0.8);

  const status: ContextStatusLevel = isCompacted ? "compacted" : computeStatusLevel(percent);

  const compactionCount = isCompacted
    ? (input.previousStatus?.compactionCount ?? 0) + 1
    : input.previousStatus?.compactionCount;

  return {
    provider: input.provider,
    support: input.support,
    source: input.source,
    // TODO(v1.2): Produce "stale" when a background timer detects no token-usage
    // event within a configurable threshold while a session is active. The UI
    // already handles stale rendering gracefully (contextStatusIndicator.logic.ts).
    freshness: "live",
    status,
    model: input.model,
    tokenUsage: input.usage,
    ...(maxInputTokens !== null ? { contextWindowLimit: maxInputTokens } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(isCompacted
      ? { lastCompactedAt: input.measuredAt }
      : input.previousStatus?.lastCompactedAt
        ? { lastCompactedAt: input.previousStatus.lastCompactedAt }
        : {}),
    ...(isCompacted
      ? { lastCompactionReason: input.source === "compact-boundary" ? "compact-boundary" : "token-count-drop" }
      : input.previousStatus?.lastCompactionReason
        ? { lastCompactionReason: input.previousStatus.lastCompactionReason }
        : {}),
    ...(compactionCount !== undefined ? { compactionCount } : {}),
    measuredAt: input.measuredAt,
  } as OrchestrationThreadContextStatus;
}

function computeStatusLevel(percent: number | undefined): ContextStatusLevel {
  if (percent === undefined) return "unknown";
  if (percent >= 95) return "near-limit";
  if (percent >= 75) return "watch";
  return "ok";
}
