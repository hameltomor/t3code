/**
 * Pure normalization functions that convert provider-specific raw token usage
 * payloads into the canonical NormalizedTokenUsage shape.
 *
 * Each function is synchronous and side-effect-free. Provider-specific raw
 * types are defined as plain TypeScript interfaces (not Effect schemas) since
 * they only serve as input descriptions for these transformers.
 *
 * @module tokenUsageNormalization
 */
import type { NormalizedTokenUsage } from "@xbetools/contracts";

// ---------------------------------------------------------------------------
// Codex raw types
// ---------------------------------------------------------------------------

export interface CodexTokenUsageBreakdown {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export interface CodexThreadTokenUsage {
  readonly total: CodexTokenUsageBreakdown;
  readonly last: CodexTokenUsageBreakdown;
  readonly modelContextWindow?: number | null;
}

// ---------------------------------------------------------------------------
// Claude Code raw types
// ---------------------------------------------------------------------------

export interface ClaudeRawUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
}

// ---------------------------------------------------------------------------
// Gemini raw types
// ---------------------------------------------------------------------------

export interface GeminiRawUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly totalTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly thoughtsTokenCount?: number;
}

// ---------------------------------------------------------------------------
// Normalization functions
// ---------------------------------------------------------------------------

/**
 * Normalize a Codex app-server `thread/tokenUsage/updated` payload into
 * {@link NormalizedTokenUsage}. Maps the `total` breakdown; `last` and
 * `modelContextWindow` are intentionally dropped (downstream uses registry).
 */
export function normalizeCodexUsage(raw: CodexThreadTokenUsage): NormalizedTokenUsage {
  return {
    inputTokens: raw.total.inputTokens,
    outputTokens: raw.total.outputTokens,
    totalTokens: raw.total.totalTokens,
    cachedInputTokens: raw.total.cachedInputTokens,
    reasoningTokens: raw.total.reasoningOutputTokens,
  };
}

/**
 * Normalize a Claude Code SDK `NonNullableUsage` (snake_case) payload into
 * {@link NormalizedTokenUsage}. `cache_creation_input_tokens` is NOT mapped
 * because it is already counted inside `input_tokens`.
 */
export function normalizeClaudeUsage(raw: ClaudeRawUsage): NormalizedTokenUsage {
  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    totalTokens: raw.input_tokens + raw.output_tokens,
    cachedInputTokens: raw.cache_read_input_tokens,
  };
}

/**
 * Normalize a Gemini `GenerateContentResponseUsageMetadata` payload into
 * {@link NormalizedTokenUsage}. Undefined numeric fields default to 0 for
 * input/output. Optional fields (`cachedInputTokens`, `reasoningTokens`) are
 * only included when the raw data provides them.
 */
export function normalizeGeminiUsage(raw: GeminiRawUsageMetadata): NormalizedTokenUsage {
  const input = raw.promptTokenCount ?? 0;
  const output = raw.candidatesTokenCount ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: raw.totalTokenCount ?? input + output,
    ...(raw.cachedContentTokenCount !== undefined
      ? { cachedInputTokens: raw.cachedContentTokenCount }
      : {}),
    ...(raw.thoughtsTokenCount !== undefined
      ? { reasoningTokens: raw.thoughtsTokenCount }
      : {}),
  };
}
