# Phase 8: Provider Normalization - Research

**Researched:** 2026-03-13
**Domain:** Provider adapter token usage emission, cross-provider normalization, Claude Code SDK / Google GenAI SDK / Codex app-server usage payloads
**Confidence:** HIGH

## Summary

Phase 8 converts the existing `Schema.Unknown` token usage payloads into typed, provider-specific schemas and introduces a normalization layer that converts all three provider-specific shapes into the canonical `NormalizedTokenUsage` defined in Phase 7. The work spans three provider adapters (Codex, Claude Code, Gemini) plus a shared normalization module.

The Codex adapter already emits `thread.token-usage.updated` events but passes the payload through as untyped `Schema.Unknown`. The Claude Code adapter does NOT emit `thread.token-usage.updated` at all -- it only includes `usage` data in the `turn.completed` payload. The Gemini adapter has no token usage emission whatsoever. The key work is: (1) define typed schemas for each provider's raw usage shape, (2) add emission logic to Claude Code and Gemini adapters, (3) build a normalization function that converts any of the three raw shapes into `NormalizedTokenUsage`, and (4) replace the `Schema.Unknown` in `ThreadTokenUsageUpdatedPayload` with the normalized type.

**Primary recommendation:** Build the normalization layer as pure functions in `packages/contracts` (or a new file in `apps/server/src/provider/`), define provider-specific raw usage schemas alongside it, and add emission logic directly in each adapter's event handling code. Use fixture-based tests with real recorded payloads to verify normalization.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| effect (Schema) | smol pre-release | Schema definitions, validation, branded types | Already used throughout contracts |
| @xbetools/contracts | workspace | Shared schema-only package | All type definitions live here |
| @anthropic-ai/claude-agent-sdk | 0.2.71 | Claude Code SDK types (NonNullableUsage, ModelUsage, SDKCompactBoundaryMessage) | Already a dependency; provides the raw usage types |
| @google/genai | 1.44.0 | Google GenAI SDK types (GenerateContentResponseUsageMetadata, CountTokensResponse) | Already a dependency; provides the raw usage types |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @effect/vitest | catalog | Effect-aware test runner | Adapter integration tests |
| vitest | catalog | Test framework | Normalization fixture tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Normalization in contracts | Normalization in apps/server | Contracts is schema-only (no runtime logic per CLAUDE.md), so normalization functions should live in server or shared |
| Provider-specific schemas in contracts | Provider-specific schemas in server | Server-side keeps provider-specific details out of the shared schema package |

## Architecture Patterns

### Recommended Project Structure

```
apps/server/src/provider/
  normalization/
    NormalizedTokenUsage.ts     # normalizeCodexUsage, normalizeClaudeUsage, normalizeGeminiUsage
    NormalizedTokenUsage.test.ts # fixture tests with real payloads
    CodexTokenUsage.ts          # Codex-specific raw schema (ThreadTokenUsage, TokenUsageBreakdown)
    ClaudeTokenUsage.ts         # Claude-specific raw schema extraction helpers
    GeminiTokenUsage.ts         # Gemini-specific raw schema extraction helpers
  Layers/
    CodexAdapter.ts             # Modified: typed payload instead of Schema.Unknown
    ClaudeCodeAdapter.ts        # Modified: emit thread.token-usage.updated on assistant/result
    GeminiAdapter.ts            # Modified: emit thread.token-usage.updated from usageMetadata
```

Alternative: Place all normalization logic in a single file `apps/server/src/provider/tokenUsageNormalization.ts`. This is simpler if the per-provider extraction is small (it likely is).

### Pattern 1: Normalization Layer as Pure Functions

**What:** A set of pure functions that convert provider-specific raw usage payloads into `NormalizedTokenUsage`.
**When to use:** Every time a provider adapter emits or passes through token usage data.
**Example:**

```typescript
import { type NormalizedTokenUsage } from "@xbetools/contracts";

// Codex raw shape (from codex app-server generate-json-schema)
interface CodexTokenUsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface CodexThreadTokenUsage {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow?: number | null;
}

export function normalizeCodexUsage(raw: CodexThreadTokenUsage): NormalizedTokenUsage {
  const total = raw.total;
  return {
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    totalTokens: total.totalTokens,
    cachedInputTokens: total.cachedInputTokens,
    reasoningTokens: total.reasoningOutputTokens,
  };
}
```

### Pattern 2: Adapter Emission Pattern (Claude Code)

**What:** Emit `thread.token-usage.updated` from within the adapter's message handling loop whenever usage data arrives.
**When to use:** For Claude Code, emit on `SDKResultMessage` (which has `usage: NonNullableUsage` and `modelUsage`). For Gemini, emit after each `generateContent` response.
**Example (Claude Code result handler):**

```typescript
// In handleResultMessage, after completeTurn:
const normalizedUsage = normalizeClaudeUsage(message.usage);
yield* offerRuntimeEvent({
  type: "thread.token-usage.updated",
  eventId: stamp.eventId,
  provider: PROVIDER,
  threadId: context.sessionKey,
  createdAt: stamp.createdAt,
  payload: {
    usage: normalizedUsage,
    support: "derived-live",
    source: "sdk-usage",
  },
});
```

### Pattern 3: Compaction-Correlated Context Status (Claude Code)

**What:** When `compact_boundary` arrives, emit a context status update that includes compaction metadata.
**When to use:** Only in the Claude Code adapter when `message.subtype === "compact_boundary"`.
**Note:** This does NOT require emitting `thread.token-usage.updated` -- it instead dispatches `thread.context-status.set` through the orchestration engine (Phase 9 concern), or emits a thread state change with compaction metadata. For Phase 8, the adapter should emit the `thread.token-usage.updated` event and note the compaction correlation in the raw event data. The downstream `ProviderRuntimeIngestion` (Phase 9) will handle dispatching `thread.context-status.set`.

### Pattern 4: Best-Effort Gemini countTokens

**What:** Wrap `countTokens` calls in try/catch and swallow failures silently.
**When to use:** When calling `ai.models.countTokens()` in the Gemini adapter.
**Example:**

```typescript
const tokenCount = yield* Effect.tryPromise({
  try: () => ctx.ai.models.countTokens({ model: ctx.model, contents }),
  catch: () => null, // Never surface as error
}).pipe(Effect.catchAll(() => Effect.succeed(null)));
// Use tokenCount if available, skip if null
```

### Anti-Patterns to Avoid

- **Don't normalize in the web client:** All normalization must happen server-side before events are projected to orchestration domain events. The web client should only see `NormalizedTokenUsage`.
- **Don't make normalization async or effectful:** These are pure data transformations. They should be synchronous functions.
- **Don't block turn flow on usage emission:** Token usage events are informational. If normalization fails (e.g., unexpected shape), log a warning and skip -- never block the turn lifecycle.
- **Don't duplicate `NormalizedTokenUsage` schema:** It already exists in `packages/contracts/src/orchestration.ts` from Phase 7. Import it, don't redefine it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token usage schema validation | Manual field checking | Effect Schema `Schema.decodeUnknownSync` with provider-specific schemas | Codebase standard; safe decode with typed errors |
| Provider detection for normalization | Manual provider string checks | `ProviderKind` from contracts + pattern matching | Already a typed union |
| Total token computation | Manual `input + output` addition | Trust provider total when available, compute only as fallback | Provider totals include hidden tokens (reasoning, system) that input+output may miss |

**Key insight:** The normalization layer is simple data mapping. Each function is ~10-15 lines. The complexity is in correctly identifying where to emit and what data is available at each emission point.

## Common Pitfalls

### Pitfall 1: Codex Payload Shape Mismatch

**What goes wrong:** Assuming Codex sends flat `{ input_tokens, output_tokens }` when it actually sends nested `{ total: { inputTokens, ... }, last: { ... }, modelContextWindow }`.
**Why it happens:** The payload was `Schema.Unknown` so nobody verified the actual shape until now.
**How to avoid:** The JSON schema from `codex app-server generate-json-schema` (verified 2026-03-13) is the authoritative source. The payload uses camelCase field names (`inputTokens`, not `input_tokens`), has a `total` and `last` breakdown, and includes `modelContextWindow`.
**Warning signs:** Schema decode errors when processing Codex events.

### Pitfall 2: Claude Usage Available Only on Result, Not Mid-Turn

**What goes wrong:** Trying to emit token usage on every `SDKAssistantMessage` when the `BetaMessage.usage` field may not be populated mid-stream.
**Why it happens:** The `BetaMessage` type has optional `usage`, but the Claude SDK docs note it's populated on the complete message, not partial deltas.
**How to avoid:** Emit `thread.token-usage.updated` from the `SDKResultMessage` handler (`handleResultMessage`) which always has `usage: NonNullableUsage`. Optionally also emit from `handleAssistantMessage` if `message.message.usage` is populated, but don't rely on it.
**Warning signs:** Missing usage events during streaming.

### Pitfall 3: Gemini usageMetadata Timing

**What goes wrong:** Expecting `usageMetadata` to be on every streaming chunk when it's only populated on the final response or specific chunks.
**Why it happens:** The Gemini adapter uses non-streaming `generateContent` for the tool loop, so `usageMetadata` is available on every response. But if streaming is added later, only the last chunk has `usageMetadata`.
**How to avoid:** Check `response.usageMetadata` after each `callGemini` response. The current non-streaming approach guarantees it's available.
**Warning signs:** `usageMetadata` being undefined.

### Pitfall 4: Forgetting to Update ThreadTokenUsageUpdatedPayload

**What goes wrong:** Adding normalization logic but leaving `usage: Schema.Unknown` in the contracts payload definition, so the pipeline isn't actually typed end-to-end.
**Why it happens:** The payload schema in `providerRuntime.ts` line 292-295 has `usage: Schema.Unknown`.
**How to avoid:** Update `ThreadTokenUsageUpdatedPayload` in `packages/contracts/src/providerRuntime.ts` to use a typed schema. This could be the canonical `NormalizedTokenUsage` directly, or a wrapper that includes metadata like `support` tier.
**Warning signs:** TypeScript doesn't catch shape mismatches at the boundary.

### Pitfall 5: countTokens Rate Limiting on Gemini

**What goes wrong:** Calling `countTokens` on every turn loop iteration causes rate limit errors from Google's API.
**Why it happens:** The Gemini tool loop can iterate up to 25 times per turn, each with a `generateContent` call. Adding `countTokens` multiplies API calls.
**How to avoid:** Only call `countTokens` once per turn (e.g., on the initial user message or on turn completion), not on every loop iteration. Alternatively, rely solely on `usageMetadata` from `generateContent` responses and skip `countTokens` entirely.
**Warning signs:** Gemini 429 errors during turns.

## Code Examples

### Verified Codex TokenUsage Shape (from `codex app-server generate-json-schema`)

```json
{
  "threadId": "string",
  "turnId": "string",
  "tokenUsage": {
    "total": {
      "inputTokens": 0,
      "outputTokens": 0,
      "cachedInputTokens": 0,
      "reasoningOutputTokens": 0,
      "totalTokens": 0
    },
    "last": {
      "inputTokens": 0,
      "outputTokens": 0,
      "cachedInputTokens": 0,
      "reasoningOutputTokens": 0,
      "totalTokens": 0
    },
    "modelContextWindow": 400000
  }
}
```

**Confidence:** HIGH -- verified via `codex app-server generate-json-schema` on 2026-03-13.
**Key observations:**
- Uses camelCase (`inputTokens`, not `input_tokens`)
- Has `total` and `last` breakdown objects
- `modelContextWindow` is optional (nullable)
- `reasoningOutputTokens` maps to `reasoningTokens` in `NormalizedTokenUsage`
- All fields in `TokenUsageBreakdown` are required integers

### Verified Claude Code Usage Shape (from `@anthropic-ai/claude-agent-sdk` 0.2.71)

```typescript
// From sdk.d.ts -- NonNullableUsage is BetaUsage with all fields NonNullable
type NonNullableUsage = {
  [K in keyof BetaUsage]: NonNullable<BetaUsage[K]>;
};

// BetaUsage (from @anthropic-ai/sdk) has:
// input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens

// ModelUsage (per-model breakdown):
type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;       // <-- context window per model!
  maxOutputTokens: number;     // <-- max output per model!
};

// SDKResultMessage has:
// usage: NonNullableUsage      -- aggregated across all models
// modelUsage: Record<string, ModelUsage>  -- per-model breakdown

// SDKCompactBoundaryMessage has:
// compact_metadata: { trigger: 'manual' | 'auto', pre_tokens: number }
```

**Confidence:** HIGH -- verified from installed SDK type definitions.
**Key observations:**
- `BetaUsage` uses snake_case (`input_tokens`, `cache_read_input_tokens`)
- `ModelUsage` uses camelCase and includes `contextWindow` and `maxOutputTokens` -- can be used for ContextWindowRegistry validation
- `SDKCompactBoundaryMessage.compact_metadata.pre_tokens` gives the pre-compaction token count
- Usage is only reliably available on `SDKResultMessage`, not mid-stream

### Verified Gemini UsageMetadata Shape (from `@google/genai` 1.44.0)

```typescript
// From genai.d.ts
class GenerateContentResponseUsageMetadata {
  promptTokenCount?: number;           // input tokens
  candidatesTokenCount?: number;       // output tokens
  totalTokenCount?: number;            // total
  cachedContentTokenCount?: number;    // cached input tokens
  thoughtsTokenCount?: number;         // reasoning tokens (Gemini-specific)
  toolUsePromptTokenCount?: number;    // tool result tokens fed back as input
  // + various *Details fields with per-modality breakdowns
}

// CountTokensResponse:
class CountTokensResponse {
  totalTokens?: number;
  cachedContentTokenCount?: number;
}
```

**Confidence:** HIGH -- verified from installed SDK type definitions.
**Key observations:**
- All fields are optional (can be undefined)
- Uses `promptTokenCount` / `candidatesTokenCount` (not `inputTokens` / `outputTokens`)
- Has `thoughtsTokenCount` for reasoning tokens
- `countTokens` returns only `totalTokens` and `cachedContentTokenCount` -- much less data than `usageMetadata`
- Best strategy: use `usageMetadata` from `generateContent` responses, skip `countTokens`

### Normalization Functions

```typescript
import { type NormalizedTokenUsage } from "@xbetools/contracts";

// -- Codex --
interface CodexTokenUsageBreakdown {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

interface CodexThreadTokenUsage {
  readonly total: CodexTokenUsageBreakdown;
  readonly last: CodexTokenUsageBreakdown;
  readonly modelContextWindow?: number | null;
}

export function normalizeCodexUsage(raw: CodexThreadTokenUsage): NormalizedTokenUsage {
  return {
    inputTokens: raw.total.inputTokens,
    outputTokens: raw.total.outputTokens,
    totalTokens: raw.total.totalTokens,
    cachedInputTokens: raw.total.cachedInputTokens,
    reasoningTokens: raw.total.reasoningOutputTokens,
  };
}

// -- Claude Code --
interface ClaudeRawUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
}

export function normalizeClaudeUsage(raw: ClaudeRawUsage): NormalizedTokenUsage {
  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    totalTokens: raw.input_tokens + raw.output_tokens,
    cachedInputTokens: raw.cache_read_input_tokens,
    // cache_creation_input_tokens not mapped -- it's already counted in input_tokens
  };
}

// -- Gemini --
interface GeminiRawUsageMetadata {
  readonly promptTokenCount?: number;
  readonly candidatesTokenCount?: number;
  readonly totalTokenCount?: number;
  readonly cachedContentTokenCount?: number;
  readonly thoughtsTokenCount?: number;
}

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
```

### Fixture Test Pattern

```typescript
import { describe, expect, it } from "vitest";
import { normalizeCodexUsage, normalizeClaudeUsage, normalizeGeminiUsage } from "./NormalizedTokenUsage";

describe("normalizeCodexUsage", () => {
  it("normalizes a real Codex token usage payload", () => {
    const raw = {
      total: {
        inputTokens: 15420,
        outputTokens: 3200,
        cachedInputTokens: 8000,
        reasoningOutputTokens: 1200,
        totalTokens: 18620,
      },
      last: {
        inputTokens: 5420,
        outputTokens: 1200,
        cachedInputTokens: 3000,
        reasoningOutputTokens: 400,
        totalTokens: 6620,
      },
      modelContextWindow: 400000,
    };

    const result = normalizeCodexUsage(raw);
    expect(result).toEqual({
      inputTokens: 15420,
      outputTokens: 3200,
      totalTokens: 18620,
      cachedInputTokens: 8000,
      reasoningTokens: 1200,
    });
  });
});
```

## Provider Usage Data Summary

| Aspect | Codex | Claude Code | Gemini |
|--------|-------|-------------|--------|
| **Event** | `thread/tokenUsage/updated` (native) | Not emitted (must add) | Not emitted (must add) |
| **Data source** | Codex app-server notification | `SDKResultMessage.usage` + `modelUsage` | `GenerateContentResponse.usageMetadata` |
| **Emission timing** | Per-turn, emitted by app-server | On result message (turn completion) | After each `generateContent` response |
| **Support tier** | `native` | `derived-live` | `derived-on-demand` |
| **Source** | `provider-event` | `sdk-usage` | `sdk-usage` |
| **Input tokens field** | `inputTokens` (camelCase) | `input_tokens` (snake_case) | `promptTokenCount` |
| **Output tokens field** | `outputTokens` | `output_tokens` | `candidatesTokenCount` |
| **Cached tokens** | `cachedInputTokens` | `cache_read_input_tokens` | `cachedContentTokenCount` |
| **Reasoning tokens** | `reasoningOutputTokens` | Not available | `thoughtsTokenCount` |
| **Total tokens** | `totalTokens` | Must compute: input + output | `totalTokenCount` |
| **Context window** | `modelContextWindow` on payload | `ModelUsage.contextWindow` per model | Not available (use registry) |
| **Compaction** | N/A (Codex manages internally) | `compact_boundary` with `pre_tokens` | N/A |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `usage: Schema.Unknown` on all events | Typed `NormalizedTokenUsage` | Phase 8 | Full type safety through pipeline |
| Only Codex emits token usage | All three providers emit | Phase 8 | Uniform data for context status computation |
| No support tier labeling | Each adapter labels `native`/`derived-live`/`derived-on-demand` | Phase 8 | Downstream can adjust freshness display |
| Raw provider payloads passed through | Provider-specific payloads normalized before consumption | Phase 8 | Single consumption shape for all downstream code |

## Open Questions

1. **Should `ThreadTokenUsageUpdatedPayload` in providerRuntime.ts change from `usage: Schema.Unknown` to `usage: NormalizedTokenUsage`?**
   - What we know: The payload is currently `{ usage: Schema.Unknown }`. Phase 8 needs to type this.
   - Options: (A) Change to `NormalizedTokenUsage` directly, (B) Create a wrapper that includes `support` and `source` metadata alongside usage.
   - Recommendation: Option B is better -- create a typed payload that includes `usage: NormalizedTokenUsage` plus `support: ContextStatusSupport` and `source: ContextStatusSource`. This aligns with PROV-06 (labeling support tiers) and gives downstream consumers the metadata they need.

2. **Should the normalization happen in the adapter (before event emission) or in ProviderRuntimeIngestion (after event reception)?**
   - What we know: The adapter emits `ProviderRuntimeEvent`, which flows through `ProviderRuntimeIngestion`. Normalizing at emission means the event payload is always typed. Normalizing at ingestion means adapters emit raw data.
   - Recommendation: Normalize at emission (in the adapter). This keeps the `ProviderRuntimeEvent` payload typed, which benefits the NDJSON logger, tests, and any other consumer of the event stream. The normalization functions are pure and have no dependencies.

3. **How to handle Codex `modelContextWindow` -- pass it through the event or ignore it?**
   - What we know: Codex sends `modelContextWindow` in the token usage payload. The `ContextWindowRegistry` (Phase 7) already resolves limits by model slug.
   - Recommendation: Include it in the normalized payload metadata (not in `NormalizedTokenUsage` itself) so downstream can use the provider-reported value if the registry doesn't have it. This is especially useful for new/unknown models.

## Sources

### Primary (HIGH confidence)
- **Codex app-server JSON schema** -- `codex app-server generate-json-schema` output, verified 2026-03-13. `ThreadTokenUsageUpdatedNotification.json` defines the exact `ThreadTokenUsage` / `TokenUsageBreakdown` structure.
- **Claude Code SDK types** -- `@anthropic-ai/claude-agent-sdk@0.2.71` `sdk.d.ts`, installed in the workspace. Defines `NonNullableUsage`, `ModelUsage`, `SDKCompactBoundaryMessage`, `SDKResultMessage`.
- **Google GenAI SDK types** -- `@google/genai@1.44.0` `genai.d.ts`, installed in the workspace. Defines `GenerateContentResponseUsageMetadata`, `CountTokensResponse`.
- **Codebase analysis** -- `apps/server/src/provider/Layers/CodexAdapter.ts` (line 700-709), `ClaudeCodeAdapter.ts` (line 860-960, 1273-1282), `GeminiAdapter.ts` (full file), `packages/contracts/src/providerRuntime.ts` (line 292-295), `packages/contracts/src/orchestration.ts` (line 228-274).

### Secondary (MEDIUM confidence)
- Phase 7 research (`07-RESEARCH.md`) -- context window limits, schema patterns, prior decisions

## Metadata

**Confidence breakdown:**
- Codex payload shape: HIGH -- verified via `codex app-server generate-json-schema`
- Claude Code usage fields: HIGH -- verified from installed SDK type definitions
- Gemini usage fields: HIGH -- verified from installed SDK type definitions
- Normalization approach: HIGH -- pure data mapping, well-understood
- Integration points: HIGH -- clear emission points identified in each adapter

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (30 days -- SDK versions may bump but usage shapes are stable)
