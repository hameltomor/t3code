# Stack Research: Session Context Status Tracking

**Domain:** Real-time token usage tracking, context window monitoring, provider usage normalization, UI status visualization
**Researched:** 2026-03-13
**Codebase revision:** effect-smol `8881a9b` (effect v4 pre-release catalog pin)
**Confidence:** HIGH for server-side patterns (grounded in source inspection), MEDIUM for provider-specific token payload shapes (some payloads typed as `Schema.Unknown` and need runtime validation)

---

## Context

XBE Code wraps three providers (Codex app-server, Claude Code SDK, Gemini API) behind an event-sourced orchestration engine. The existing `thread.token-usage.updated` runtime event exists in contracts but carries `usage: Schema.Unknown` -- a raw pass-through with no typed normalization. The goal is to:

1. Type and normalize token usage across all three providers
2. Build a ContextWindowRegistry mapping model slugs to their token limits
3. Create a thread-scoped context status projection (server-side)
4. Push live context status to the web UI for a composer footer badge

---

## 1. NO New Server Dependencies Required

### Recommendation: Zero new npm packages on the server

**Confidence: HIGH**

Everything needed for the server-side context status feature is already available through the installed stack:

| Capability | Already Have | Package |
|------------|-------------|---------|
| Effect Schema for typed token usage | Yes | `effect` (catalog) |
| Effect Ref for mutable projection state | Yes | `effect` |
| Effect PubSub for broadcasting changes | Yes | `effect` |
| SQLite persistence for projection | Yes | `@effect/sql-sqlite-bun` (catalog) |
| WebSocket push to clients | Yes | `ws` + existing WS infrastructure |
| Codex token events | Yes | `thread/tokenUsage/updated` mapped in CodexAdapter |
| Claude Code SDK usage | Yes | `@anthropic-ai/claude-agent-sdk` ^0.2.62 |
| Gemini SDK response metadata | Yes | `@google/genai` ^1.44.0 |

**Rationale:** The project already has all the building blocks. Adding packages for token counting or model metadata lookup would be over-engineering -- the data arrives from the providers themselves or can be stored in a static registry.

---

## 2. NO New Web Dependencies Required

### Recommendation: Zero new npm packages on the web

**Confidence: HIGH**

The UI needs for the context status badge are fully covered:

| Capability | Already Have | Package/Component |
|------------|-------------|-------------------|
| Badge component with variants | Yes | `~/components/ui/badge.tsx` (default, info, warning, error variants) |
| Tooltip for detailed hover info | Yes | `~/components/ui/tooltip.tsx` (Base UI primitives) |
| Zustand store for thread state | Yes | `zustand` ^5.0.11 |
| Icons for context indicator | Yes | `lucide-react` ^0.564.0 (has `Gauge`, `CircleAlert`, `Brain` etc.) |
| Tailwind for progress bar styling | Yes | `tailwindcss` ^4.0.0 |
| Responsive layout logic | Yes | `composerFooterLayout.ts` existing breakpoint system |

**What NOT to add:**
- No charting library (overkill for a simple percentage bar/badge)
- No `@radix-ui/react-progress` (can be done with a simple div + width percentage + tailwind)
- No external token counting library (server provides the numbers)

---

## 3. Provider Token Usage Data Shapes

### 3a. Codex App-Server (Native Token Events)

**Provider support label: native**
**Confidence: MEDIUM** -- the payload is currently `Schema.Unknown` in the adapter; shape inferred from Codex documentation and community analysis

The Codex app-server emits `thread/tokenUsage/updated` notifications natively during turns. The CodexAdapter at line 700 already maps these to `thread.token-usage.updated` runtime events with `payload: { usage: event.payload ?? {} }`.

**Expected payload shape** (needs runtime validation, generate from `codex app-server generate-json-schema` for authoritative version):

```typescript
// Codex token usage payload (native from app-server)
interface CodexTokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  // May also include (version-dependent):
  cached_tokens?: number;
  reasoning_tokens?: number;
}
```

**Key characteristics:**
- Arrives as a STREAMING notification (multiple updates per turn)
- Cumulative within the thread (not per-turn deltas)
- Includes context window position natively
- Also present in `turn.completed` payload as `usage` and `modelUsage` fields

**Integration point:** `CodexAdapter.ts` line 700-710 -- already mapped, just needs typed extraction.

### 3b. Claude Code SDK (Derived-Live from Result Messages)

**Provider support label: derived-live**
**Confidence: HIGH** -- verified against official Anthropic documentation

The `@anthropic-ai/claude-agent-sdk` provides token usage at two levels:

1. **Per-step** (on each `assistant` message): `message.message.usage` with `input_tokens`, `output_tokens`
2. **Per-query result** (on `result` message): `result.usage`, `result.modelUsage`, `result.total_cost_usd`

The ClaudeCodeAdapter at line 879 already extracts `result.usage` and `result.modelUsage` into `turn.completed` events.

**Usage object shape** (from official Anthropic docs):

```typescript
// Available on SDKResultMessage.usage
interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Available on SDKResultMessage.modelUsage (per-model breakdown)
interface ClaudeModelUsage {
  [modelName: string]: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
  };
}
```

**Key characteristics:**
- NOT streaming -- only available at turn completion (per-step on assistant messages, cumulative on result)
- Per-query, not cumulative across session -- must sum across turns for thread total
- Cost data included natively (`total_cost_usd`)
- Cache tokens provide optimization insights

**Integration point:** `ClaudeCodeAdapter.ts` lines 879/952 -- already extracted into `turn.completed` payload. The adapter should ALSO emit `thread.token-usage.updated` events by accumulating across turns.

### 3c. Gemini API (Derived-On-Demand from Response Metadata)

**Provider support label: derived-on-demand**
**Confidence: HIGH** -- verified against official Google documentation and SDK source

The `@google/genai` SDK's `GenerateContentResponse` includes `usageMetadata`:

```typescript
// Available on GenerateContentResponse.usageMetadata
interface GeminiUsageMetadata {
  promptTokenCount: number;       // Input tokens
  candidatesTokenCount: number;   // Output tokens
  totalTokenCount: number;        // Total
  // May also include (version-dependent):
  thoughtsTokenCount?: number;    // Thinking tokens (Gemini 2.5+)
  cachedContentTokenCount?: number;
}
```

**Key characteristics:**
- NOT streaming -- available per-response only
- The GeminiAdapter currently DOES NOT extract `usageMetadata` at all (verified by grep -- no matches for `usageMetadata`, `totalTokenCount`, etc.)
- Each `generateContent` call returns usage for that specific call; must accumulate across the agent loop iterations
- Multiple calls per turn (tool loop) means token counts compound

**Integration point:** `GeminiAdapter.ts` lines 340-364 (`callGemini` function) -- the `GenerateContentResponse` is returned but `usageMetadata` is discarded. Must extract and accumulate.

### 3d. Gemini models.get() for Model Metadata

The `@google/genai` SDK provides `ai.models.get()` which returns model metadata including `inputTokenLimit` and `outputTokenLimit`. This can be used to dynamically query context window sizes.

```typescript
const modelInfo = await ai.models.get({ model: "gemini-2.5-flash" });
// modelInfo.inputTokenLimit  -> 1048576
// modelInfo.outputTokenLimit -> 65536
```

**Recommendation:** Do NOT call this at runtime per-session. Use a static ContextWindowRegistry instead (see section 5). The API call adds latency and a network dependency. Hardcode known values and use `models.get()` only as a fallback for unrecognized model slugs.

---

## 4. Normalized Token Usage Schema

### Recommendation: Single canonical schema in `packages/contracts`

**Confidence: HIGH**

Replace the `usage: Schema.Unknown` in `ThreadTokenUsageUpdatedPayload` with a typed, provider-normalized schema:

```typescript
// In packages/contracts/src/providerRuntime.ts (or new contextStatus.ts)
export const NormalizedTokenUsage = Schema.Struct({
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  totalTokens: Schema.Int,
  cacheReadTokens: Schema.optional(Schema.Int),
  cacheWriteTokens: Schema.optional(Schema.Int),
  reasoningTokens: Schema.optional(Schema.Int),
  costUsd: Schema.optional(Schema.Number),
});

export const ThreadContextStatus = Schema.Struct({
  threadId: ThreadId,
  provider: ProviderKind,
  model: TrimmedNonEmptyString,
  /** Cumulative token usage across all turns in this thread */
  usage: NormalizedTokenUsage,
  /** Context window capacity for the active model */
  contextWindowSize: Schema.Int,
  /** Percentage of context window consumed (0.0 - 1.0) */
  contextUtilization: Schema.Number,
  /** Threshold states for UI rendering */
  contextLevel: Schema.Literals(["normal", "elevated", "warning", "critical"]),
  /** When this status was last updated */
  updatedAt: IsoDateTime,
});
```

**Normalization mapping per provider:**

| Canonical Field | Codex | Claude Code | Gemini |
|----------------|-------|-------------|--------|
| `inputTokens` | `input_tokens` | `input_tokens` | `promptTokenCount` |
| `outputTokens` | `output_tokens` | `output_tokens` | `candidatesTokenCount` |
| `totalTokens` | `total_tokens` | sum(input+output) | `totalTokenCount` |
| `cacheReadTokens` | `cached_tokens` | `cache_read_input_tokens` | `cachedContentTokenCount` |
| `cacheWriteTokens` | -- | `cache_creation_input_tokens` | -- |
| `reasoningTokens` | `reasoning_tokens` | -- | `thoughtsTokenCount` |
| `costUsd` | -- | `total_cost_usd` | -- |

Each adapter performs normalization at the point of emission. The orchestration engine and UI only deal with the canonical schema.

---

## 5. ContextWindowRegistry (Static Model Metadata)

### Recommendation: Hardcoded registry in `packages/contracts/src/model.ts`

**Confidence: HIGH** -- model context limits are well-documented by all three providers

This belongs in contracts because both server and web need it. Add to the existing `model.ts` file alongside `MODEL_OPTIONS_BY_PROVIDER`:

```typescript
export interface ModelContextWindow {
  readonly inputTokenLimit: number;
  readonly outputTokenLimit: number;
  /** Effective context window for utilization tracking */
  readonly effectiveContextWindow: number;
}

export const MODEL_CONTEXT_WINDOWS: Record<string, ModelContextWindow> = {
  // Codex models
  "gpt-5.4":              { inputTokenLimit: 1_000_000, outputTokenLimit: 64_000,  effectiveContextWindow: 1_000_000 },
  "gpt-5.3-codex":        { inputTokenLimit: 400_000,   outputTokenLimit: 64_000,  effectiveContextWindow: 400_000 },
  "gpt-5.3-codex-spark":  { inputTokenLimit: 400_000,   outputTokenLimit: 64_000,  effectiveContextWindow: 400_000 },
  "gpt-5.2-codex":        { inputTokenLimit: 400_000,   outputTokenLimit: 64_000,  effectiveContextWindow: 400_000 },
  "gpt-5.2":              { inputTokenLimit: 272_000,   outputTokenLimit: 64_000,  effectiveContextWindow: 272_000 },

  // Claude Code models
  "claude-opus-4-6":      { inputTokenLimit: 200_000,   outputTokenLimit: 128_000, effectiveContextWindow: 200_000 },
  "claude-sonnet-4-6":    { inputTokenLimit: 200_000,   outputTokenLimit: 64_000,  effectiveContextWindow: 200_000 },
  "claude-haiku-4-5":     { inputTokenLimit: 200_000,   outputTokenLimit: 64_000,  effectiveContextWindow: 200_000 },

  // Gemini models
  "gemini-3.1-pro-preview":       { inputTokenLimit: 1_000_000, outputTokenLimit: 64_000,  effectiveContextWindow: 1_000_000 },
  "gemini-3-flash-preview":       { inputTokenLimit: 200_000,   outputTokenLimit: 64_000,  effectiveContextWindow: 200_000 },
  "gemini-3.1-flash-lite-preview":{ inputTokenLimit: 1_000_000, outputTokenLimit: 64_000,  effectiveContextWindow: 1_000_000 },
  "gemini-2.5-pro":               { inputTokenLimit: 1_000_000, outputTokenLimit: 65_536,  effectiveContextWindow: 1_000_000 },
  "gemini-2.5-flash":             { inputTokenLimit: 1_000_000, outputTokenLimit: 65_536,  effectiveContextWindow: 1_000_000 },
  "gemini-2.5-flash-lite":        { inputTokenLimit: 1_000_000, outputTokenLimit: 65_536,  effectiveContextWindow: 1_000_000 },
} as const;

// Default fallback for unknown models
export const DEFAULT_CONTEXT_WINDOW: ModelContextWindow = {
  inputTokenLimit: 200_000,
  outputTokenLimit: 64_000,
  effectiveContextWindow: 200_000,
};

export function getModelContextWindow(modelSlug: string): ModelContextWindow {
  return MODEL_CONTEXT_WINDOWS[modelSlug] ?? DEFAULT_CONTEXT_WINDOW;
}
```

**Why hardcoded instead of API calls:**
- Codex app-server does not expose a model metadata API
- Claude Code SDK does not expose model limits
- Gemini `models.get()` requires an API key and network call per lookup
- Context limits change rarely (quarterly at most)
- A static registry is deterministic, fast, and testable
- Update cadence: bump values when new model versions are added to `MODEL_OPTIONS_BY_PROVIDER`

**LOW confidence values flagged for validation:**
- GPT-5.4 at 1M tokens (recent, from GitHub issue #13738 discussion)
- GPT-5.3/5.2 variants (inferred from Codex documentation mentioning 272k-400k range)
- Gemini 3.x models (preview, limits may change before GA)
- Claude models use 200K default; 1M beta context (`context-1m-2025-08-07`) not tracked here because the SDK manages it internally

---

## 6. Server-Side Projection Pattern

### Recommendation: In-memory Ref-based projection with WebSocket broadcast

**Confidence: HIGH** -- follows established projection patterns in the codebase

The existing projection pipeline (`ProjectionPipeline.ts`) handles persistent projections backed by SQLite. The context status projection should follow a DIFFERENT pattern:

**Use an in-memory `Effect.Ref` per thread, NOT a SQLite projection.**

Rationale:
- Context status is ephemeral -- it resets when a session ends or restarts
- It changes rapidly during turns (especially Codex which streams token updates)
- SQLite writes per token update would be excessive and wasteful
- The read model needs only the latest value, not history
- On session restart, the provider sends fresh cumulative values

**Pattern to follow:**

```typescript
// New service: ContextStatusProjection
// Located: apps/server/src/orchestration/Services/ContextStatusProjection.ts

import { Effect, Ref, HashMap, PubSub } from "effect";

interface ContextStatusProjectionShape {
  /** Handle a token usage update from a provider runtime event */
  readonly handleTokenUsage: (
    threadId: ThreadId,
    event: ProviderRuntimeThreadTokenUsageUpdatedEvent | ProviderRuntimeTurnCompletedEvent,
  ) => Effect.Effect<void>;

  /** Get current context status for a thread */
  readonly getStatus: (threadId: ThreadId) => Effect.Effect<ThreadContextStatus | null>;

  /** Subscribe to context status changes */
  readonly changes: PubSub.PubSub<ThreadContextStatus>;

  /** Clear status when session ends */
  readonly clearThread: (threadId: ThreadId) => Effect.Effect<void>;
}
```

This integrates with the existing `ProviderRuntimeIngestion` flow. The ingestion layer already processes every runtime event -- add a hook that routes `thread.token-usage.updated` and `turn.completed` events to this new projection.

**Broadcast to clients:** Subscribe to the `changes` PubSub in `wsServer.ts` and push on a new channel `orchestration.contextStatus` (or piggyback on the existing `orchestration.domainEvent` channel with a new event type).

---

## 7. Client-Side State Pattern

### Recommendation: Extend Thread type in Zustand store with contextStatus field

**Confidence: HIGH** -- follows existing patterns in `store.ts` and `types.ts`

Add to the existing `Thread` interface in `apps/web/src/types.ts`:

```typescript
export interface ThreadContextStatus {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindowSize: number;
  contextUtilization: number; // 0.0 - 1.0
  contextLevel: "normal" | "elevated" | "warning" | "critical";
  costUsd?: number;
  updatedAt: string;
}

export interface Thread {
  // ... existing fields ...
  contextStatus: ThreadContextStatus | null;
}
```

Update the store's event handler to process incoming context status push messages, similar to how `orchestration.domainEvent` updates thread state today.

**NO React Query needed** -- this is a push-based update, not a fetch. The existing WebSocket subscription pattern in `wsNativeApi.ts` handles this.

---

## 8. UI Component Pattern

### Recommendation: Composer footer badge using existing Badge + Tooltip primitives

**Confidence: HIGH** -- existing components verified

The UI rendering requires zero new component libraries. Use the existing stack:

| Component | Source | Usage |
|-----------|--------|-------|
| `Badge` | `~/components/ui/badge.tsx` | Context status pill (variant by level) |
| `Tooltip` + `TooltipPopup` | `~/components/ui/tooltip.tsx` | Detailed breakdown on hover |
| `Gauge` or `Brain` icon | `lucide-react` | Visual indicator in badge |
| `composerFooterLayout.ts` | Existing | Responsive breakpoint awareness |

**Badge variant mapping:**

| contextLevel | Badge variant | Color semantics |
|--------------|---------------|-----------------|
| `normal` | `outline` | Subtle, non-distracting |
| `elevated` | `info` | Blue, informational |
| `warning` | `warning` | Yellow/amber, attention |
| `critical` | `error` | Red, danger |

**Progress bar:** A simple Tailwind div with percentage width:

```tsx
<div className="h-1 w-full rounded-full bg-muted">
  <div
    className="h-full rounded-full transition-[width] duration-300"
    style={{ width: `${Math.min(utilization * 100, 100)}%` }}
    data-level={contextLevel}
  />
</div>
```

Style the inner div color with `data-level` attribute using Tailwind `data-[level=warning]:bg-warning` etc.

---

## 9. Context Level Thresholds

### Recommendation: Configurable thresholds, sensible defaults

**Confidence: HIGH** -- based on common UX patterns for resource monitors

```typescript
export const CONTEXT_LEVEL_THRESHOLDS = {
  elevated: 0.50,  // 50% -- informational
  warning:  0.75,  // 75% -- user should be aware
  critical: 0.90,  // 90% -- action needed soon
} as const;

export function computeContextLevel(utilization: number): "normal" | "elevated" | "warning" | "critical" {
  if (utilization >= CONTEXT_LEVEL_THRESHOLDS.critical) return "critical";
  if (utilization >= CONTEXT_LEVEL_THRESHOLDS.warning) return "warning";
  if (utilization >= CONTEXT_LEVEL_THRESHOLDS.elevated) return "elevated";
  return "normal";
}
```

Place in `packages/contracts` so both server and web can use it.

---

## 10. WebSocket Push Channel

### Recommendation: New dedicated channel `orchestration.contextStatus`

**Confidence: HIGH** -- follows existing channel pattern

Add to `packages/contracts/src/orchestration.ts`:

```typescript
export const ORCHESTRATION_WS_CHANNELS = {
  domainEvent: "orchestration.domainEvent",
  contextStatus: "orchestration.contextStatus", // NEW
} as const;
```

**Why a separate channel instead of piggybacking on `domainEvent`:**
- Context status updates are high-frequency during turns (especially Codex)
- Clients that do not show context status should not parse these messages
- Keeps the domain event stream focused on orchestration state changes
- Allows independent throttling (server can debounce context status pushes at 200-500ms without affecting domain events)

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Token counting | Provider-reported values | Client-side token estimation (tiktoken/etc) | Inaccurate, adds bundle size, providers already report exact counts |
| Model limits | Static registry | Runtime API calls to providers | Adds latency, network dependency, Codex has no such API |
| Projection storage | In-memory Ref | SQLite table | Too many writes, ephemeral data, no replay value |
| UI progress | Tailwind div | @radix-ui/react-progress | Unnecessary dependency for a simple percentage bar |
| WebSocket channel | Dedicated channel | Piggyback on domainEvent | High frequency updates would pollute domain event stream |
| State management | Zustand store field | Separate React context | Fragment state unnecessarily, thread already in store |
| Token normalization | Adapter-side mapping | Server-side post-processing | Adapters already have provider-specific knowledge; normalize at source |

---

## Installation

**No new packages required.** Zero changes to any `package.json`.

The entire feature is buildable with:
- `effect` (Ref, PubSub, Schema, HashMap)
- `@anthropic-ai/claude-agent-sdk` (existing -- extract `usage` from result messages)
- `@google/genai` (existing -- extract `usageMetadata` from responses)
- `zustand` (existing -- extend Thread type)
- `lucide-react` (existing -- icons for badge)
- `tailwindcss` (existing -- progress bar styling)

---

## Sources

### Official Documentation
- [Anthropic Claude Agent SDK - Track Cost and Usage](https://platform.claude.com/docs/en/agent-sdk/cost-tracking) -- HIGH confidence, verified token usage structure
- [Anthropic Claude Agent SDK - TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- HIGH confidence, SDKResultMessage schema
- [Google GenerateContentResponse](https://googleapis.github.io/js-genai/release_docs/classes/types.GenerateContentResponse.html) -- HIGH confidence, usageMetadata structure
- [Google Gemini Token Documentation](https://ai.google.dev/gemini-api/docs/tokens) -- HIGH confidence, token counting and model limits
- [Codex App Server Documentation](https://developers.openai.com/codex/app-server/) -- MEDIUM confidence, thread/tokenUsage/updated event
- [Codex SDK Documentation](https://developers.openai.com/codex/sdk/) -- MEDIUM confidence, general architecture

### Model Context Window Limits
- [OpenAI GPT-5 Codex Model](https://platform.openai.com/docs/models/gpt-5-codex) -- MEDIUM confidence for exact numbers
- [Claude Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) -- HIGH confidence
- [Claude Context Windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) -- HIGH confidence, 200K default / 1M beta
- [Gemini Models](https://ai.google.dev/gemini-api/docs/models) -- MEDIUM confidence for preview models
- [Gemini 3 Pro Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro) -- MEDIUM confidence

### Codebase (Primary Source)
- `packages/contracts/src/providerRuntime.ts` lines 292-295 -- ThreadTokenUsageUpdatedPayload (Schema.Unknown)
- `apps/server/src/provider/Layers/CodexAdapter.ts` lines 700-710 -- Codex token usage mapping
- `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` lines 879/952 -- Claude usage extraction
- `apps/server/src/provider/Layers/GeminiAdapter.ts` lines 340-364 -- Gemini response handling (no usage extraction)
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` -- Existing projection pattern
- `apps/web/src/components/ui/badge.tsx` -- Badge component with variant system
- `apps/web/src/components/ui/tooltip.tsx` -- Tooltip primitives
- `apps/web/src/components/composerFooterLayout.ts` -- Responsive breakpoint logic
- `packages/contracts/src/model.ts` -- MODEL_OPTIONS_BY_PROVIDER registry
