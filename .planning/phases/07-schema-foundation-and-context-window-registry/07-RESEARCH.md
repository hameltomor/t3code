# Phase 7: Schema Foundation and Context Window Registry - Research

**Researched:** 2026-03-13
**Domain:** Effect Schema definitions, model context window resolution, event-sourced command/event pipeline
**Confidence:** HIGH

## Summary

Phase 7 introduces two foundational capabilities: (1) typed canonical schemas for token usage and thread context status, and (2) a context window registry that resolves model slugs to token limits. Both live in `packages/contracts` (schemas) and `packages/shared` (registry runtime), with integration points in the orchestration command/event union and the `OrchestrationThread` read model.

The existing codebase already has well-established patterns for Effect Schema definitions, branded IDs, command/event unions, and model slug resolution. The work in this phase is primarily schema definition and static data -- no database migrations, no adapter changes, no UI changes. The key risk is getting the `NormalizedTokenUsage` shape right for all three providers (Codex, Claude Code, Gemini) since the raw payloads differ, and some model context limits are from preview/unstable sources.

**Primary recommendation:** Define all new schemas in `packages/contracts/src/orchestration.ts` following the exact patterns already used for `OrchestrationSession`, `OrchestrationCheckpointSummary`, etc. Place the `ContextWindowRegistry` in `packages/shared/src/model.ts` alongside the existing `normalizeModelSlug` and `MODEL_OPTIONS_BY_PROVIDER` infrastructure.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| effect (Schema) | smol pre-release (pkg.pr.new/Effect-TS/effect-smol/effect@8881a9b) | Schema definitions, validation, branded types | Already used throughout contracts -- `Schema.Struct`, `Schema.Literals`, `Schema.optional`, branded IDs |
| @xbetools/contracts | workspace | Shared schema-only package | All type definitions live here, consumed by server and web |
| @xbetools/shared | workspace | Shared runtime utilities with subpath exports | Model resolution logic already lives at `@xbetools/shared/model` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @effect/vitest | catalog | Effect-aware test runner | Schema validation tests |
| vitest | catalog | Test framework | Pure function tests for registry |

## Architecture Patterns

### Recommended Structure (contracts additions)

All new schemas go in existing files -- no new files needed in contracts:

```
packages/contracts/src/
  orchestration.ts          # Add: NormalizedTokenUsage, OrchestrationThreadContextStatus,
                            #       ThreadContextStatusSetCommand, context-status-set event types,
                            #       contextStatus field on OrchestrationThread
  model.ts                  # (no changes needed -- MODEL_OPTIONS_BY_PROVIDER already here)

packages/shared/src/
  model.ts                  # Add: ContextWindowRegistry (getContextWindowLimit function),
                            #       CONTEXT_WINDOW_LIMITS map, model alias resolution chain
  model.test.ts             # Add: Registry tests
```

### Pattern 1: Schema Definition Pattern (from existing codebase)

**What:** Effect Schema structs with branded types, Literals for enums, optional fields with defaults.
**When to use:** All new schemas follow this pattern exactly.
**Example (from existing `orchestration.ts`):**

```typescript
// Enum-like schemas use Schema.Literals
export const OrchestrationSessionStatus = Schema.Literals([
  "idle", "starting", "running", "ready", "interrupted", "stopped", "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

// Struct schemas use Schema.Struct with typed fields
export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;
```

### Pattern 2: Command/Event Union Extension Pattern

**What:** New commands are added to the internal command union; new events get their own event type, payload, and slots in both `OrchestrationEvent` and `OrchestrationPersistedEvent`.
**When to use:** The `thread.context-status.set` command follows `thread.session.set` exactly.
**Example (from existing `orchestration.ts`):**

```typescript
// 1. Define the command schema
const ThreadContextStatusSetCommand = Schema.Struct({
  type: Schema.Literal("thread.context-status.set"),
  commandId: CommandId,
  threadId: ThreadId,
  contextStatus: OrchestrationThreadContextStatus,
  createdAt: IsoDateTime,
});

// 2. Add to InternalOrchestrationCommand union (server-only, not client-dispatched)
const InternalOrchestrationCommand = Schema.Union([
  // ... existing commands ...
  ThreadContextStatusSetCommand,
]);

// 3. Define event type and payload
// 4. Add to OrchestrationEventType literals
// 5. Add to OrchestrationEvent union
// 6. Add to OrchestrationPersistedEvent union
```

### Pattern 3: Read Model Field Addition

**What:** Adding `contextStatus` to `OrchestrationThread` as a nullable field with a decoding default.
**When to use:** When the field is optional/progressive (not all threads will have context status initially).
**Example (from existing `OrchestrationThread`):**

```typescript
export const OrchestrationThread = Schema.Struct({
  // ... existing fields ...
  session: Schema.NullOr(OrchestrationSession),
  // New field follows same nullable pattern:
  contextStatus: Schema.NullOr(OrchestrationThreadContextStatus).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
```

### Pattern 4: Registry as Pure Functions (shared package)

**What:** The `ContextWindowRegistry` is a set of pure functions in `@xbetools/shared/model`, not an Effect Service/Layer. It resolves model slugs to context window limits using a static map + alias resolution.
**When to use:** Always -- this is static data lookup, not a service with dependencies.
**Example (following existing `normalizeModelSlug` pattern):**

```typescript
export interface ContextWindowLimit {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

const CONTEXT_WINDOW_LIMITS: Record<string, ContextWindowLimit> = {
  "gpt-5.4": { maxInputTokens: 1_050_000, maxOutputTokens: 128_000 },
  // ... all models ...
};

export function getContextWindowLimit(
  model: string | null | undefined,
  provider?: ProviderKind,
): ContextWindowLimit | null {
  // 1. Normalize alias -> canonical slug
  // 2. Lookup in static map
  // 3. Return null for unknown
}
```

### Anti-Patterns to Avoid
- **Don't make ContextWindowRegistry an Effect Service/Layer:** It's pure static data lookup. The existing `normalizeModelSlug` is a pure function, and this follows the same pattern.
- **Don't use `Schema.Unknown` for new usage fields:** The whole point of this phase is to replace `Schema.Unknown` with typed schemas. The existing `ThreadTokenUsageUpdatedPayload.usage: Schema.Unknown` stays as-is until Phase 8 replaces it.
- **Don't add migrations or persistence in this phase:** Phase 9 handles `projection_thread_context_status` table. This phase is contracts + shared only.
- **Don't modify provider adapters:** Phase 8 handles adapter changes. This phase only defines the target schemas.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Model alias resolution | Custom alias lookup | Existing `normalizeModelSlug` from `@xbetools/shared/model` | Already handles all provider-scoped aliases; extend, don't duplicate |
| Schema validation | Manual runtime checks | Effect Schema `Schema.decodeUnknownSync` / `Schema.decodeUnknownEffect` | Codebase standard; provides typed errors |
| Branded IDs | Raw strings | `makeEntityId` from `baseSchemas.ts` | Pattern used for all IDs in the system |
| Enum types | String unions | `Schema.Literals(["value1", "value2"])` | Codebase standard; validates at decode boundary |

**Key insight:** All patterns needed for this phase already exist in the codebase. No new libraries, no new architectural patterns. This is pure schema extension work.

## Common Pitfalls

### Pitfall 1: Breaking the OrchestrationCommand Union Exhaustiveness
**What goes wrong:** Adding a new command type to `InternalOrchestrationCommand` without updating the decider's exhaustive switch creates a TypeScript error or runtime `Unknown command type` failure.
**Why it happens:** The decider in `decider.ts` uses `command satisfies never` as an exhaustive check.
**How to avoid:** When adding `thread.context-status.set` command, also add the matching case in `decider.ts`, event type in `OrchestrationEventType` literals, event variant in `OrchestrationEvent` union, and persisted event variant in `OrchestrationPersistedEvent` union.
**Warning signs:** `bun typecheck` fails with "`never` is not assignable to type" error.

### Pitfall 2: Missing `withDecodingDefault` on New Optional Fields
**What goes wrong:** Adding `contextStatus` to `OrchestrationThread` without a decoding default breaks hydration of existing threads from the database (which lack this field).
**Why it happens:** Existing persisted data doesn't have the new field.
**How to avoid:** Use `Schema.NullOr(X).pipe(Schema.withDecodingDefault(() => null))` for any new field on `OrchestrationThread`.
**Warning signs:** Snapshot query fails on startup when replaying existing events.

### Pitfall 3: Forgetting Both Event Unions
**What goes wrong:** Adding the event to `OrchestrationEvent` but forgetting `OrchestrationPersistedEvent` (or vice versa).
**Why it happens:** There are two parallel union definitions -- one using `EventBaseFields` (aggregateId) and one using `PersistedEventBaseFields` (streamId + streamVersion + actorKind). They must stay in sync.
**How to avoid:** Add the new event type to BOTH `OrchestrationEvent` and `OrchestrationPersistedEvent` unions simultaneously. Also update `OrchestrationEventType` literals.
**Warning signs:** Event store persistence fails silently or decode errors at event replay.

### Pitfall 4: Model Context Limits Becoming Stale
**What goes wrong:** Hardcoded context window limits become wrong when providers update models.
**Why it happens:** Model limits change with new releases (e.g., GPT-5.4 expanded from 272K to 1M).
**How to avoid:** Add source comments with verification dates on every limit entry. Group the map by provider. Design for easy updates -- a single flat record, not nested structures.
**Warning signs:** Users see incorrect percentage calculations when providers update limits.

### Pitfall 5: NormalizedTokenUsage Schema Too Rigid for Provider Variance
**What goes wrong:** Schema requires fields that some providers don't supply (e.g., `cachedInputTokens` from Codex but not Gemini).
**Why it happens:** Different providers report different subsets of token usage data.
**How to avoid:** Make all fields optional except the ones every provider can supply. Use `Schema.optional(NonNegativeInt)` for provider-specific fields like `cachedInputTokens`, `reasoningTokens`.
**Warning signs:** Phase 8 adapter work requires schema changes because fields are too strict.

## Code Examples

### NormalizedTokenUsage Schema

```typescript
// All fields optional except totalTokens (which can always be computed or estimated)
export const NormalizedTokenUsage = Schema.Struct({
  inputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  totalTokens: NonNegativeInt,
  cachedInputTokens: Schema.optional(NonNegativeInt),
  reasoningTokens: Schema.optional(NonNegativeInt),
});
export type NormalizedTokenUsage = typeof NormalizedTokenUsage.Type;
```

### OrchestrationThreadContextStatus Schema

```typescript
export const ContextStatusSupport = Schema.Literals([
  "native", "derived-live", "derived-on-demand", "unsupported",
]);
export type ContextStatusSupport = typeof ContextStatusSupport.Type;

export const ContextStatusSource = Schema.Literals([
  "provider-event", "sdk-usage", "count-tokens", "heuristic",
]);
export type ContextStatusSource = typeof ContextStatusSource.Type;

export const ContextStatusFreshness = Schema.Literals([
  "live", "stale", "unknown",
]);
export type ContextStatusFreshness = typeof ContextStatusFreshness.Type;

export const ContextStatusLevel = Schema.Literals([
  "ok", "watch", "near-limit", "compacted", "unknown",
]);
export type ContextStatusLevel = typeof ContextStatusLevel.Type;

export const OrchestrationThreadContextStatus = Schema.Struct({
  provider: ProviderKind,
  support: ContextStatusSupport,
  source: ContextStatusSource,
  freshness: ContextStatusFreshness,
  status: ContextStatusLevel,
  model: Schema.NullOr(TrimmedNonEmptyString),
  tokenUsage: Schema.NullOr(NormalizedTokenUsage),
  contextWindowLimit: Schema.optional(NonNegativeInt),
  percent: Schema.optional(Schema.Number),
  lastCompactedAt: Schema.optional(IsoDateTime),
  lastCompactionReason: Schema.optional(TrimmedNonEmptyString),
  compactionCount: Schema.optional(NonNegativeInt),
  measuredAt: IsoDateTime,
});
export type OrchestrationThreadContextStatus = typeof OrchestrationThreadContextStatus.Type;
```

### ContextWindowRegistry (in shared/model.ts)

```typescript
import { normalizeModelSlug } from "./model";
import { MODEL_OPTIONS_BY_PROVIDER, type ProviderKind } from "@xbetools/contracts";

export interface ContextWindowLimit {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

// Source comments mark verification date and confidence
const CONTEXT_WINDOW_LIMITS: Readonly<Record<string, ContextWindowLimit>> = {
  // Codex / OpenAI
  "gpt-5.4":              { maxInputTokens: 1_050_000, maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.4, 2026-03
  "gpt-5.3-codex":        { maxInputTokens: 400_000,   maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.3-codex, 2026-03
  "gpt-5.3-codex-spark":  { maxInputTokens: 128_000,   maxOutputTokens: 128_000 }, // openai.com blog, 2026-02 -- MEDIUM confidence
  "gpt-5.2-codex":        { maxInputTokens: 400_000,   maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.2-codex, 2026-03
  "gpt-5.2":              { maxInputTokens: 400_000,   maxOutputTokens: 128_000 }, // openai.com/api/docs/models/gpt-5.2, 2026-03

  // Claude Code / Anthropic
  "claude-opus-4-6":      { maxInputTokens: 200_000,   maxOutputTokens: 128_000 }, // platform.claude.com/docs, 2026-03
  "claude-sonnet-4-6":    { maxInputTokens: 200_000,   maxOutputTokens: 64_000 },  // platform.claude.com/docs, 2026-03
  "claude-haiku-4-5":     { maxInputTokens: 200_000,   maxOutputTokens: 64_000 },  // platform.claude.com/docs, 2026-03

  // Gemini / Google
  "gemini-3.1-pro-preview":       { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai, 2026-03
  "gemini-3-flash-preview":       { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai, 2026-03
  "gemini-3.1-flash-lite-preview": { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai + deepmind, 2026-03
  "gemini-2.5-pro":               { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // cloud.google.com, 2026-03
  "gemini-2.5-flash":             { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // verified 2026-03
  "gemini-2.5-flash-lite":        { maxInputTokens: 1_048_576, maxOutputTokens: 65_536 }, // openrouter.ai, 2026-03
};

export function getContextWindowLimit(
  model: string | null | undefined,
  provider?: ProviderKind,
): ContextWindowLimit | null {
  if (!model) return null;

  // Try direct lookup first
  const direct = CONTEXT_WINDOW_LIMITS[model];
  if (direct) return direct;

  // Try alias resolution (uses existing normalizeModelSlug)
  if (provider) {
    const normalized = normalizeModelSlug(model, provider);
    if (normalized) {
      const resolved = CONTEXT_WINDOW_LIMITS[normalized];
      if (resolved) return resolved;
    }
  } else {
    // Try all providers for alias resolution
    for (const p of ["codex", "claudeCode", "gemini"] as const) {
      const normalized = normalizeModelSlug(model, p);
      if (normalized && CONTEXT_WINDOW_LIMITS[normalized]) {
        return CONTEXT_WINDOW_LIMITS[normalized]!;
      }
    }
  }

  // Unknown model -- return null, never guess
  return null;
}
```

### Command and Event Wiring Example

```typescript
// In orchestration.ts -- following existing thread.session.set pattern:

// 1. Command
const ThreadContextStatusSetCommand = Schema.Struct({
  type: Schema.Literal("thread.context-status.set"),
  commandId: CommandId,
  threadId: ThreadId,
  contextStatus: OrchestrationThreadContextStatus,
  createdAt: IsoDateTime,
});

// 2. Add to InternalOrchestrationCommand
const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  // ... existing ...
  ThreadContextStatusSetCommand,   // <-- new
]);

// 3. Event payload
export const ThreadContextStatusSetPayload = Schema.Struct({
  threadId: ThreadId,
  contextStatus: OrchestrationThreadContextStatus,
});

// 4. Add "thread.context-status-set" to OrchestrationEventType literals

// 5. Add event variant to OrchestrationEvent union:
Schema.Struct({
  ...EventBaseFields,
  type: Schema.Literal("thread.context-status-set"),
  payload: ThreadContextStatusSetPayload,
}),

// 6. Add to OrchestrationPersistedEvent union (same payload, PersistedEventBaseFields)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `usage: Schema.Unknown` on token events | Will become `NormalizedTokenUsage` (Phase 7 defines, Phase 8 applies) | Phase 7 | Typed usage throughout the pipeline |
| No context status on threads | `contextStatus: OrchestrationThreadContextStatus` field | Phase 7 | Enables context window UI (Phase 10) |
| No model limit resolution | `ContextWindowRegistry` in shared/model | Phase 7 | Enables percentage calculation |
| Scattered model constants | Single `CONTEXT_WINDOW_LIMITS` map | Phase 7 | Single source of truth for limits |

**Note:** Claude Opus 4.6 and Sonnet 4.6 support a 1M token context window via beta header (`context-1m-2025-08-07`), but standard context is 200K. The registry uses the standard 200K since Claude Code SDK likely uses the standard context. If Claude Code SDK activates the 1M beta, the registry can be updated.

## Model Context Window Limits Reference

| Model Slug | Provider | Max Input Tokens | Max Output Tokens | Confidence | Source |
|------------|----------|-----------------|-------------------|------------|--------|
| `gpt-5.4` | codex | 1,050,000 | 128,000 | HIGH | [OpenAI API docs](https://developers.openai.com/api/docs/models/gpt-5.4) |
| `gpt-5.3-codex` | codex | 400,000 | 128,000 | HIGH | [OpenAI API docs](https://developers.openai.com/api/docs/models/gpt-5.3-codex) |
| `gpt-5.3-codex-spark` | codex | 128,000 | 128,000 | MEDIUM | [OpenAI blog](https://openai.com/index/introducing-gpt-5-3-codex-spark/) -- research preview |
| `gpt-5.2-codex` | codex | 400,000 | 128,000 | HIGH | [OpenAI API docs](https://developers.openai.com/api/docs/models/gpt-5.2-codex) |
| `gpt-5.2` | codex | 400,000 | 128,000 | HIGH | [OpenAI API docs](https://developers.openai.com/api/docs/models/gpt-5.2) |
| `claude-opus-4-6` | claudeCode | 200,000 | 128,000 | HIGH | [Anthropic docs](https://platform.claude.com/docs/en/about-claude/models/overview) |
| `claude-sonnet-4-6` | claudeCode | 200,000 | 64,000 | HIGH | [Anthropic docs](https://platform.claude.com/docs/en/about-claude/models/overview) |
| `claude-haiku-4-5` | claudeCode | 200,000 | 64,000 | HIGH | [Anthropic docs](https://platform.claude.com/docs/en/about-claude/models/overview) |
| `gemini-3.1-pro-preview` | gemini | 1,048,576 | 65,536 | MEDIUM | [OpenRouter](https://openrouter.ai/google/gemini-3.1-pro-preview) -- preview model |
| `gemini-3-flash-preview` | gemini | 1,048,576 | 65,536 | MEDIUM | [OpenRouter](https://openrouter.ai/google/gemini-3-flash-preview) -- preview model |
| `gemini-3.1-flash-lite-preview` | gemini | 1,048,576 | 65,536 | MEDIUM | [OpenRouter](https://openrouter.ai/google/gemini-3.1-flash-lite-preview), [DeepMind](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/) |
| `gemini-2.5-pro` | gemini | 1,048,576 | 65,536 | HIGH | [Google Cloud](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro) |
| `gemini-2.5-flash` | gemini | 1,048,576 | 65,536 | HIGH | Verified via multiple sources |
| `gemini-2.5-flash-lite` | gemini | 1,048_576 | 65,536 | HIGH | [Vertex AI docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite) |

## Provider Token Usage Payload Shapes (for NormalizedTokenUsage design)

Understanding what each provider actually sends is critical for designing `NormalizedTokenUsage`:

### Codex (`thread/tokenUsage/updated`)
**Confidence:** MEDIUM -- exact schema is version-specific; can be verified with `codex app-server generate-json-schema`
**Expected fields (based on OpenAI Responses API patterns):**
- `input_tokens`, `output_tokens`, `total_tokens`
- `input_tokens_details.cached_tokens` (cached input)
- `output_tokens_details.reasoning_tokens`

### Claude Code SDK (from `result.usage` and `result.modelUsage`)
**Confidence:** HIGH -- Claude API usage object is well-documented
**Fields:**
- `input_tokens`, `output_tokens`
- `cache_creation_input_tokens`, `cache_read_input_tokens`

### Gemini (`usageMetadata` on GenerateContentResponse)
**Confidence:** HIGH -- Google Gemini API is well-documented
**Fields:**
- `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`
- `cachedContentTokenCount` (when applicable)

### Design Implication
All three providers supply input + output + total. Cached tokens and reasoning tokens are provider-specific. The `NormalizedTokenUsage` schema must make these optional.

## Open Questions

1. **Codex `thread/tokenUsage/updated` exact payload shape**
   - What we know: The event exists and is emitted by the app-server. The CodexAdapter currently passes `event.payload ?? {}` through as `Schema.Unknown`.
   - What's unclear: Exact field names and structure. Could be `{ input_tokens, output_tokens, total_tokens }` or nested with `_details` sub-objects.
   - Recommendation: Mark as MEDIUM confidence in the static schema. Phase 8 will verify with `codex app-server generate-json-schema` and adjust if needed. The NormalizedTokenUsage schema is intentionally flexible with optional fields to absorb provider variance.

2. **Should `totalTokens` be required or computed?**
   - What we know: All three providers can supply a total. But if computing from `input + output`, the sum may not match the provider's total (e.g., reasoning tokens).
   - Recommendation: Make `totalTokens` required in `NormalizedTokenUsage`. The normalization layer (Phase 8) is responsible for computing it if the provider doesn't supply it directly.

3. **GPT-5.4 context window: 1,050,000 vs 272,000?**
   - What we know: GPT-5.4 supports up to 1M tokens but the standard window without explicit configuration is reportedly 272K. The Codex app-server may auto-configure this.
   - Recommendation: Use 1,050,000 (the documented API limit) in the registry. The Codex app-server manages compaction thresholds independently.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** -- `packages/contracts/src/orchestration.ts`, `packages/contracts/src/providerRuntime.ts`, `packages/contracts/src/model.ts`, `packages/shared/src/model.ts`
- [Anthropic Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) -- context windows: 200K standard (1M beta) for Opus 4.6 and Sonnet 4.6, 200K for Haiku 4.5
- [OpenAI GPT-5.4 Model](https://developers.openai.com/api/docs/models/gpt-5.4) -- 1,050,000 context window, 128,000 max output
- [OpenAI GPT-5.3-Codex Model](https://developers.openai.com/api/docs/models/gpt-5.3-codex) -- 400,000 context window, 128,000 max output
- [OpenAI GPT-5.2 Model](https://developers.openai.com/api/docs/models/gpt-5.2) -- 400,000 context window, 128,000 max output
- [OpenAI GPT-5.2-Codex Model](https://developers.openai.com/api/docs/models/gpt-5.2-codex) -- 400,000 context window, 128,000 max output
- [Google Vertex AI Gemini 2.5 Flash-Lite](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite) -- 1,048,576 context window

### Secondary (MEDIUM confidence)
- [OpenRouter Gemini 3.1 Pro Preview](https://openrouter.ai/google/gemini-3.1-pro-preview) -- 1,048,576 context, 65,536 output
- [OpenRouter Gemini 3 Flash Preview](https://openrouter.ai/google/gemini-3-flash-preview) -- 1,048,576 context, 65,536 output
- [OpenRouter Gemini 3.1 Flash Lite Preview](https://openrouter.ai/google/gemini-3.1-flash-lite-preview) -- 1,048,576 context, 65,536 output
- [OpenAI Codex App Server docs](https://developers.openai.com/codex/app-server/) -- `thread/tokenUsage/updated` notification exists but payload not detailed

### Tertiary (LOW confidence)
- GPT-5.3-Codex-Spark 128K context window -- from [OpenAI blog](https://openai.com/index/introducing-gpt-5-3-codex-spark/) and [community discussion](https://community.openai.com/t/gpt-5-3-codex-spark-research-preview-with-1000-tokens-per-second/1374091); research preview, may change

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all patterns exist in codebase, no new dependencies
- Architecture: HIGH -- follows exact existing command/event patterns
- Schema design: HIGH -- requirements are specific and well-defined
- Model context limits: MEDIUM -- preview/newer models may change; source comments mitigate
- Codex token usage payload shape: MEDIUM -- exact fields need Phase 8 verification

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (30 days for schema patterns; model limits may need refresh sooner if providers update)
