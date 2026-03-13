# Architecture Patterns: Session Context Status Integration

**Domain:** Context window status tracking for multi-provider code agent GUI
**Researched:** 2026-03-13
**Confidence:** HIGH -- based on direct codebase analysis of all integration points

## Executive Summary

This document describes how the new session context status feature integrates with the existing event-sourced orchestration architecture. The feature adds a `contextStatus` field to `OrchestrationThread` that shows per-thread token usage, context window capacity, and cost data. It follows existing patterns: a new internal orchestration command (`thread.context-status.set`) is dispatched by `ProviderRuntimeIngestion` when it receives `thread.token-usage.updated` runtime events, a new projector persists the data to a new `projection_thread_context_status` table, and the snapshot query hydrates it onto the read model for WebSocket push to the Zustand store.

All three providers must emit normalized `thread.token-usage.updated` events. A `ContextWindowRegistry` service resolves max context window size per model. The web compositor footer renders usage inline.

---

## Existing Architecture Overview

### Data Flow (current)

```
ProviderAdapter (Codex/ClaudeCode/Gemini)
    |
    | emits ProviderRuntimeEvent (e.g. thread.token-usage.updated)
    |
    v
ProviderService.streamEvents
    |
    v
ProviderRuntimeIngestion (apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts)
    |
    | converts runtime events to orchestration commands
    | dispatches via OrchestrationEngineService.dispatch()
    |
    v
OrchestrationEngineService (apps/server/src/orchestration/Services/OrchestrationEngine.ts)
    |
    | persists event to OrchestrationEventStore
    | updates in-memory read model
    | emits to streamDomainEvents
    |
    v
ProjectionPipeline (apps/server/src/orchestration/Layers/ProjectionPipeline.ts)
    |
    | each projector handles relevant event types
    | writes to projection_* SQLite tables
    | updates projection_state cursor
    |
    v
ProjectionSnapshotQuery (apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts)
    |
    | reads all projection tables in a transaction
    | assembles OrchestrationReadModel
    |
    v
WebSocket push via orchestration.domainEvent channel
    |
    v
apps/web/src/store.ts -> syncServerReadModel()
    |
    | maps OrchestrationThread -> Thread (web type)
    |
    v
Zustand store -> React components
```

### Key Architectural Patterns

**1. Effect Service/Layer pattern (ServiceMap.Service)**

Every service follows the same pattern:
- `Services/Foo.ts` -- defines interface shape + `ServiceMap.Service` class
- `Layers/Foo.ts` -- `Layer.effect(FooService, make)` implementing the shape

Example from `ProjectionSnapshotQuery`:
```typescript
// Services/ProjectionSnapshotQuery.ts
export interface ProjectionSnapshotQueryShape {
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;
}
export class ProjectionSnapshotQuery extends ServiceMap.Service<
  ProjectionSnapshotQuery,
  ProjectionSnapshotQueryShape
>()("xbe/orchestration/Services/ProjectionSnapshotQuery") {}

// Layers/ProjectionSnapshotQuery.ts
export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
```

**2. Projection pattern**

Each projector is defined as a `ProjectorDefinition`:
```typescript
interface ProjectorDefinition {
  readonly name: ProjectorName;
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}
```

Projectors are registered in `ORCHESTRATION_PROJECTOR_NAMES` and iterated sequentially:
```typescript
export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: "projection.projects",
  threads: "projection.threads",
  threadMessages: "projection.thread-messages",
  threadProposedPlans: "projection.thread-proposed-plans",
  threadActivities: "projection.thread-activities",
  threadSessions: "projection.thread-sessions",
  threadTurns: "projection.thread-turns",
  checkpoints: "projection.checkpoints",
  pendingApprovals: "projection.pending-approvals",
  notifications: "projection.notifications",
} as const;
```

The `REQUIRED_SNAPSHOT_PROJECTORS` array in `ProjectionSnapshotQuery.ts` determines which projectors must be current for snapshotSequence computation. Not all projectors are required (e.g., `pendingApprovals` and `notifications` are not in the required set).

**3. Command -> Event -> Projection flow**

Internal orchestration commands (not client-dispatchable) follow the pattern:
```
ProviderRuntimeIngestion dispatches: { type: "thread.session.set", ... }
  -> Engine persists as OrchestrationEvent { type: "thread.session-set", ... }
    -> ProjectionPipeline applies: threadSessions projector handles "thread.session-set"
      -> ProjectionThreadSessionRepository.upsert(...)
```

**4. Snapshot hydration pattern**

`ProjectionSnapshotQuery.getSnapshot()` reads all projection tables in one transaction, then assembles them into maps keyed by threadId:
```typescript
const sessionsByThread = new Map<string, OrchestrationSession>();
// ... populate from query rows ...
const threads = threadRows.map((row) => ({
  ...row,
  session: sessionsByThread.get(row.threadId) ?? null,
  // ... other sub-collections
}));
```

**5. Web store sync pattern**

`syncServerReadModel()` in `apps/web/src/store.ts` maps `OrchestrationReadModel` to the web-specific `Thread` type, which strips some fields and adds UI-only state.

---

## New Components and Integration Points

### 1. Contracts: New Schema Types

**File:** `packages/contracts/src/orchestration.ts`

**New types to add:**

```typescript
// Normalized token usage data on OrchestrationThread
export const OrchestrationThreadContextStatus = Schema.Struct({
  /** Input tokens consumed so far in this thread/session. */
  inputTokens: NonNegativeInt,
  /** Output tokens consumed so far. */
  outputTokens: NonNegativeInt,
  /** Total tokens (input + output). Stored explicitly because some providers report it separately. */
  totalTokens: NonNegativeInt,
  /** Max context window size in tokens for the active model. null = unknown. */
  maxContextTokens: Schema.NullOr(NonNegativeInt),
  /** Cumulative cost in USD. null = not reported by provider. */
  totalCostUsd: Schema.NullOr(Schema.Number),
  /** ISO timestamp of last usage update. */
  updatedAt: IsoDateTime,
});
export type OrchestrationThreadContextStatus = typeof OrchestrationThreadContextStatus.Type;
```

**Modify `OrchestrationThread`:**
```typescript
export const OrchestrationThread = Schema.Struct({
  // ... existing fields ...
  contextStatus: Schema.NullOr(OrchestrationThreadContextStatus).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
```

**New internal command:**
```typescript
const ThreadContextStatusSetCommand = Schema.Struct({
  type: Schema.Literal("thread.context-status.set"),
  commandId: CommandId,
  threadId: ThreadId,
  contextStatus: OrchestrationThreadContextStatus,
  createdAt: IsoDateTime,
});
```

Add to `InternalOrchestrationCommand` union.

**New event type:**
Add `"thread.context-status-set"` to `OrchestrationEventType` literals.

**New event payload:**
```typescript
export const ThreadContextStatusSetPayload = Schema.Struct({
  threadId: ThreadId,
  contextStatus: OrchestrationThreadContextStatus,
});
```

Add corresponding entries to `OrchestrationEvent` and `OrchestrationPersistedEvent` unions.

### 2. Database Migration

**New file:** `apps/server/src/persistence/Migrations/020_ProjectionThreadContextStatus.ts`

```typescript
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_context_status (
      thread_id TEXT PRIMARY KEY,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      max_context_tokens INTEGER,
      total_cost_usd REAL,
      updated_at TEXT NOT NULL
    )
  `;
});
```

Register in `Migrations.ts` as `"20_ProjectionThreadContextStatus": Migration0020`.

### 3. Persistence: New Repository

**New service:** `apps/server/src/persistence/Services/ProjectionThreadContextStatus.ts`

```typescript
export const ProjectionThreadContextStatus = Schema.Struct({
  threadId: ThreadId,
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  totalTokens: NonNegativeInt,
  maxContextTokens: Schema.NullOr(NonNegativeInt),
  totalCostUsd: Schema.NullOr(Schema.Number),
  updatedAt: IsoDateTime,
});

export interface ProjectionThreadContextStatusRepositoryShape {
  readonly upsert: (row: ProjectionThreadContextStatus) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByThreadId: (input: { threadId: ThreadId }) => Effect.Effect<Option.Option<ProjectionThreadContextStatus>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (input: { threadId: ThreadId }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadContextStatusRepository extends ServiceMap.Service<
  ProjectionThreadContextStatusRepository,
  ProjectionThreadContextStatusRepositoryShape
>()("xbe/persistence/Services/ProjectionThreadContextStatus/ProjectionThreadContextStatusRepository") {}
```

**New layer:** `apps/server/src/persistence/Layers/ProjectionThreadContextStatus.ts`

Follows the exact pattern of `ProjectionThreadSessions.ts` -- INSERT OR REPLACE by thread_id.

### 4. Projection Pipeline: New Projector

**Modified file:** `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`

Add to `ORCHESTRATION_PROJECTOR_NAMES`:
```typescript
export const ORCHESTRATION_PROJECTOR_NAMES = {
  // ... existing entries ...
  threadContextStatus: "projection.thread-context-status",
} as const;
```

New projector function:
```typescript
const applyThreadContextStatusProjection: ProjectorDefinition["apply"] = (event) =>
  Effect.gen(function* () {
    switch (event.type) {
      case "thread.context-status-set":
        yield* projectionThreadContextStatusRepository.upsert({
          threadId: event.payload.threadId,
          inputTokens: event.payload.contextStatus.inputTokens,
          outputTokens: event.payload.contextStatus.outputTokens,
          totalTokens: event.payload.contextStatus.totalTokens,
          maxContextTokens: event.payload.contextStatus.maxContextTokens,
          totalCostUsd: event.payload.contextStatus.totalCostUsd,
          updatedAt: event.payload.contextStatus.updatedAt,
        });
        return;

      case "thread.deleted":
        yield* projectionThreadContextStatusRepository.deleteByThreadId({
          threadId: event.payload.threadId,
        });
        return;

      case "thread.reverted":
        // Context status resets on revert since the provider session restarts
        yield* projectionThreadContextStatusRepository.deleteByThreadId({
          threadId: event.payload.threadId,
        });
        return;

      default:
        return;
    }
  });
```

**Decision:** Do NOT add `threadContextStatus` to `REQUIRED_SNAPSHOT_PROJECTORS`. Context status is supplementary data -- a snapshot is valid even if this projector is behind. This matches how `pendingApprovals` and `notifications` are handled. This avoids blocking snapshot delivery on high-frequency token usage updates.

### 5. Snapshot Hydration

**Modified file:** `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`

Add a new query to list all context status rows:
```typescript
const listThreadContextStatusRows = SqlSchema.findAll({
  Request: Schema.Void,
  Result: ProjectionThreadContextStatusDbRowSchema,
  execute: () =>
    sql`
      SELECT
        thread_id AS "threadId",
        input_tokens AS "inputTokens",
        output_tokens AS "outputTokens",
        total_tokens AS "totalTokens",
        max_context_tokens AS "maxContextTokens",
        total_cost_usd AS "totalCostUsd",
        updated_at AS "updatedAt"
      FROM projection_thread_context_status
      ORDER BY thread_id ASC
    `,
});
```

Add to the `Effect.all([...])` block in `getSnapshot`, build a `Map<string, OrchestrationThreadContextStatus>`, and assign to each thread:
```typescript
const contextStatusByThread = new Map<string, OrchestrationThreadContextStatus>();
for (const row of contextStatusRows) {
  contextStatusByThread.set(row.threadId, {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    maxContextTokens: row.maxContextTokens,
    totalCostUsd: row.totalCostUsd,
    updatedAt: row.updatedAt,
  });
}

// In thread assembly:
const threads = threadRows.map((row) => ({
  // ... existing fields ...
  contextStatus: contextStatusByThread.get(row.threadId) ?? null,
}));
```

### 6. ContextWindowRegistry Service

**New file:** `packages/shared/src/contextWindow.ts` (shared subpath export)

This service resolves the max context window size for a given model slug. It uses a static curated mapping with a fallback chain:

```
1. Provider-native value (if reported in token-usage event) -> use directly
2. Curated static map (model slug -> max tokens) -> lookup
3. Provider-level API call (future, not MVP) -> null for now
4. null fallback -> UI shows "unknown" capacity
```

```typescript
// packages/shared/src/contextWindow.ts

const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  // Codex / OpenAI
  "gpt-5.4": 1_048_576,
  "gpt-5.3-codex": 524_288,
  "gpt-5.3-codex-spark": 524_288,
  "gpt-5.2-codex": 524_288,
  "gpt-5.2": 524_288,

  // Claude
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5": 200_000,

  // Gemini
  "gemini-3.1-pro-preview": 2_097_152,
  "gemini-3-flash-preview": 1_048_576,
  "gemini-3.1-flash-lite-preview": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-flash-lite": 1_048_576,
};

/**
 * Resolve the max context window tokens for a model.
 *
 * Priority: providerReportedMax > curated map > null.
 */
export function resolveMaxContextTokens(
  modelSlug: string,
  providerReportedMax?: number | null,
): number | null {
  if (typeof providerReportedMax === "number" && providerReportedMax > 0) {
    return providerReportedMax;
  }
  return KNOWN_CONTEXT_WINDOWS[modelSlug] ?? null;
}
```

Add subpath export in `packages/shared/package.json`:
```json
"./contextWindow": "./src/contextWindow.ts"
```

### 7. ProviderRuntimeIngestion: Token Usage Processing

**Modified file:** `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`

Add handling for `thread.token-usage.updated` in `processRuntimeEvent`:

```typescript
if (event.type === "thread.token-usage.updated") {
  const usage = normalizeTokenUsage(event.payload.usage, event.provider);
  if (usage) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === event.threadId);
    const modelSlug = thread?.model ?? null;
    const maxContextTokens = modelSlug
      ? resolveMaxContextTokens(modelSlug, usage.providerReportedMax)
      : null;

    yield* orchestrationEngine.dispatch({
      type: "thread.context-status.set",
      commandId: providerCommandId(event, "context-status-set"),
      threadId: event.threadId,
      contextStatus: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        maxContextTokens,
        totalCostUsd: usage.totalCostUsd ?? null,
        updatedAt: event.createdAt,
      },
      createdAt: event.createdAt,
    });
  }
}
```

**New utility function** (in the same file or a shared module):

```typescript
interface NormalizedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number | null;
  providerReportedMax: number | null;
}

function normalizeTokenUsage(
  usage: unknown,
  provider: ProviderKind,
): NormalizedTokenUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;

  // Provider-specific extraction with fallbacks
  const inputTokens = toNonNegativeInt(u.input_tokens ?? u.inputTokens ?? u.promptTokens ?? 0);
  const outputTokens = toNonNegativeInt(u.output_tokens ?? u.outputTokens ?? u.completionTokens ?? 0);
  const totalTokens = toNonNegativeInt(u.total_tokens ?? u.totalTokens ?? (inputTokens + outputTokens));
  const totalCostUsd = typeof u.total_cost_usd === "number" ? u.total_cost_usd
    : typeof u.totalCostUsd === "number" ? u.totalCostUsd
    : null;
  const providerReportedMax = typeof u.max_context_tokens === "number" ? u.max_context_tokens
    : typeof u.maxContextTokens === "number" ? u.maxContextTokens
    : null;

  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0) return null;

  return { inputTokens, outputTokens, totalTokens, totalCostUsd, providerReportedMax };
}
```

### 8. Provider Adapters: Normalized Emission

**Current state:** Only `CodexAdapter` emits `thread.token-usage.updated`. The payload is `{ usage: event.payload ?? {} }` with unstructured usage data from the Codex app-server.

**ClaudeCodeAdapter** -- does NOT currently emit token usage. Claude Code SDK provides usage data on `result` messages. The adapter must extract token counts from Claude's response and emit a `thread.token-usage.updated` event.

**GeminiAdapter** -- does NOT currently emit token usage. The Gemini SDK provides `usageMetadata` on response chunks. The adapter must extract and emit.

The key insight is that the `ThreadTokenUsageUpdatedPayload` in contracts already exists:
```typescript
const ThreadTokenUsageUpdatedPayload = Schema.Struct({
  usage: Schema.Unknown,
});
```

This is intentionally `Schema.Unknown` because each provider reports usage in its own format. The normalization happens in `ProviderRuntimeIngestion.normalizeTokenUsage()`, NOT in the adapters. This is correct -- adapters should pass through native usage data, and the ingestion layer normalizes.

**What each adapter needs:**

| Adapter | Current State | Required Change |
|---------|--------------|-----------------|
| CodexAdapter | Emits `thread.token-usage.updated` from `thread/tokenUsage/updated` JSON-RPC | No change needed. Already works. |
| ClaudeCodeAdapter | Does not emit token usage | Extract `usage` from `result` SDK messages, emit `thread.token-usage.updated` |
| GeminiAdapter | Does not emit token usage | Extract `usageMetadata` from response chunks, emit `thread.token-usage.updated` |

### 9. Web Store: Thread Type Extension

**Modified file:** `apps/web/src/types.ts`

```typescript
export interface ThreadContextStatus {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens: number | null;
  totalCostUsd: number | null;
  updatedAt: string;
}

export interface Thread {
  // ... existing fields ...
  contextStatus: ThreadContextStatus | null;
}
```

**Modified file:** `apps/web/src/store.ts`

In `syncServerReadModel`, map the new field:
```typescript
const threads = readModel.threads
  .filter((thread) => thread.deletedAt === null)
  .map((thread) => {
    return {
      // ... existing fields ...
      contextStatus: thread.contextStatus ?? null,
    };
  });
```

### 10. Web UI: Composer Footer

**Modified file:** `apps/web/src/components/ChatView.tsx`

The composer footer already has a `data-chat-composer-footer="true"` div with left-side controls and right-side submit button. The context status indicator goes in the left-side area.

```tsx
// New component: ContextStatusIndicator
function ContextStatusIndicator({ contextStatus, compact }: {
  contextStatus: ThreadContextStatus | null;
  compact: boolean;
}) {
  if (!contextStatus) return null;

  const usagePercent = contextStatus.maxContextTokens
    ? Math.min(100, (contextStatus.totalTokens / contextStatus.maxContextTokens) * 100)
    : null;

  // ... render usage bar and text
}
```

Integration point in the existing footer:
```tsx
<div data-chat-composer-footer="true" className={cn(...)}>
  <div className={cn("flex min-w-0 flex-1 items-center gap-1 ...")}>
    {/* Existing controls: model selector, attachment button, etc. */}
    {activeThread?.contextStatus && (
      <ContextStatusIndicator
        contextStatus={activeThread.contextStatus}
        compact={composerCompact}
      />
    )}
  </div>
  {/* ... submit button area ... */}
</div>
```

---

## Component Boundary Summary

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `OrchestrationThreadContextStatus` (contracts) | Schema definition for context status data | Used by all layers |
| `ThreadContextStatusSetCommand` (contracts) | Internal command to update context status | ProviderRuntimeIngestion -> Engine |
| `contextWindow.ts` (shared) | Resolve max context tokens for a model | ProviderRuntimeIngestion, Web UI |
| `ProjectionThreadContextStatusRepository` (persistence) | CRUD for `projection_thread_context_status` table | ProjectionPipeline, SnapshotQuery |
| `ProviderRuntimeIngestion` (modified) | Normalize token usage, dispatch context-status.set | Engine, ContextWindowRegistry |
| `ProjectionPipeline` (modified) | New projector for context status events | Repository |
| `ProjectionSnapshotQuery` (modified) | Hydrate contextStatus onto OrchestrationThread | Web via WebSocket |
| `ClaudeCodeAdapter` (modified) | Emit token-usage.updated events | ProviderService stream |
| `GeminiAdapter` (modified) | Emit token-usage.updated events | ProviderService stream |
| `store.ts` (web, modified) | Map contextStatus to Thread type | React components |
| `ChatView.tsx` (web, modified) | Render context status in composer footer | Store |

---

## Data Flow for Context Status

```
Provider runtime (Codex/Claude/Gemini)
    |
    | native token usage data (varied format)
    |
    v
ProviderAdapter.emit("thread.token-usage.updated", { usage: nativePayload })
    |
    v
ProviderService.streamEvents
    |
    v
ProviderRuntimeIngestion.processRuntimeEvent()
    |
    | normalizeTokenUsage(payload.usage, provider) -> NormalizedTokenUsage
    | resolveMaxContextTokens(modelSlug, providerReportedMax) -> maxContextTokens
    |
    v
OrchestrationEngine.dispatch("thread.context-status.set", { contextStatus: {...} })
    |
    v
OrchestrationEvent("thread.context-status-set")
    |
    v
ProjectionPipeline -> threadContextStatus projector
    |
    v
projection_thread_context_status table (SQLite)
    |
    v
ProjectionSnapshotQuery.getSnapshot() -> contextStatusByThread map
    |
    v
OrchestrationReadModel.threads[].contextStatus
    |
    v
WebSocket push (orchestration.domainEvent)
    |
    v
store.syncServerReadModel() -> Thread.contextStatus
    |
    v
ChatView -> ContextStatusIndicator (composer footer)
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Streaming Token Usage Through Activities
**What:** Emitting token usage as `OrchestrationThreadActivity` entries
**Why bad:** Activities are append-only and accumulate. Token usage is stateful (latest snapshot wins). Using activities would bloat the activity list and require client-side aggregation.
**Instead:** Use a dedicated projection table with upsert-by-threadId, just like `projection_thread_sessions`.

### Anti-Pattern 2: Normalizing in Adapters
**What:** Having each adapter normalize token usage into a common format before emitting
**Why bad:** Violates the existing pattern where adapters pass through native data and ingestion normalizes. Creates coupling between adapter and orchestration schema.
**Instead:** Keep adapters emitting `{ usage: nativePayload }` and normalize in `ProviderRuntimeIngestion`.

### Anti-Pattern 3: Adding contextStatus to Required Snapshot Projectors
**What:** Including `threadContextStatus` in `REQUIRED_SNAPSHOT_PROJECTORS`
**Why bad:** Token usage updates are high-frequency. Making the snapshot sequence depend on this projector could cause snapshot lag. Context status is supplementary -- the snapshot is valid without it.
**Instead:** Keep it optional like `pendingApprovals` and `notifications`.

### Anti-Pattern 4: Client-Side Token Aggregation
**What:** Having the web client parse and aggregate raw usage data from multiple events
**Why bad:** Violates the read-model pattern. The server should provide pre-computed data.
**Instead:** Server normalizes and persists; client renders what it receives.

### Anti-Pattern 5: Polling for Token Usage
**What:** Client making separate RPC calls to get token usage
**Why bad:** Adds latency and complexity. Breaks the existing push-based architecture.
**Instead:** Include contextStatus in the snapshot push, as done with all other thread data.

---

## Patterns to Follow

### Pattern 1: Projection Repository per Domain Concern
**What:** Separate SQLite table + repository + layer for each projection domain
**When:** Any new data domain that needs persistence for snapshot hydration
**Example:** Follow `ProjectionThreadSessions` exactly:
- `persistence/Services/ProjectionThreadContextStatus.ts` -- Schema + interface
- `persistence/Layers/ProjectionThreadContextStatus.ts` -- SQL implementation

### Pattern 2: Internal Command for Server-Only State
**What:** Commands that only `ProviderRuntimeIngestion` dispatches (not client-dispatchable)
**When:** State derived from provider runtime events
**Example:** `thread.context-status.set` joins `InternalOrchestrationCommand`, not `DispatchableClientOrchestrationCommand`.

### Pattern 3: Schema.withDecodingDefault for Backward Compatibility
**What:** New optional fields on existing schemas use `Schema.withDecodingDefault`
**When:** Adding fields to persisted event payloads or read model types
**Example:**
```typescript
contextStatus: Schema.NullOr(OrchestrationThreadContextStatus).pipe(
  Schema.withDecodingDefault(() => null),
),
```
This ensures existing persisted events and snapshots decode correctly without the new field.

### Pattern 4: Map-Based Snapshot Assembly
**What:** Query all rows into a Map<threadId, T>, then assign to thread objects
**When:** Adding any thread-scoped projection to the snapshot
**Example:** Follows `sessionsByThread`, `checkpointsByThread`, etc.

---

## Scalability Considerations

| Concern | At 10 threads | At 100 threads | At 1000 threads |
|---------|--------------|----------------|-----------------|
| Token usage events/sec | 1-3 per active turn | 10-30 per active turn | 100-300 per active turn |
| Projection table size | 10 rows | 100 rows | 1000 rows |
| Snapshot query overhead | Negligible | Negligible | ~1ms additional |
| Event store growth | ~50 events/thread/session | ~50 events/thread/session | Consider archiving old context-status events |

**Throttling consideration:** Token usage events can arrive rapidly (especially from Codex). The `ProviderRuntimeIngestion` processes events sequentially from a queue, which provides natural backpressure. However, if updates arrive faster than 10/sec per thread, consider debouncing in the ingestion layer (emit at most 1 context-status.set per second per thread). This is NOT needed for MVP but should be flagged for later.

---

## Suggested Build Order

The following order respects dependency chains (each step only depends on completed steps):

### Phase 1: Schema Foundation (no runtime changes)
1. **Contracts: Schema types** -- `OrchestrationThreadContextStatus`, command, event type, event payload
2. **Contracts: Modified schemas** -- Add `contextStatus` to `OrchestrationThread`, add command to `InternalOrchestrationCommand` union, add event to `OrchestrationEvent` union

### Phase 2: Server Persistence (depends on Phase 1)
3. **Migration** -- `020_ProjectionThreadContextStatus.ts`, register in `Migrations.ts`
4. **Repository service** -- `ProjectionThreadContextStatus.ts` (Service + Layer)

### Phase 3: Server Processing (depends on Phase 1 + 2)
5. **Shared: ContextWindowRegistry** -- `packages/shared/src/contextWindow.ts`
6. **ProjectionPipeline** -- Add new projector, register in `ORCHESTRATION_PROJECTOR_NAMES`
7. **ProjectionSnapshotQuery** -- Add hydration for contextStatus
8. **ProviderRuntimeIngestion** -- Handle `thread.token-usage.updated`, dispatch `thread.context-status.set`

### Phase 4: Provider Adapters (depends on Phase 1, can parallel with Phase 2-3)
9. **ClaudeCodeAdapter** -- Emit `thread.token-usage.updated` from SDK result usage
10. **GeminiAdapter** -- Emit `thread.token-usage.updated` from SDK usageMetadata

### Phase 5: Web Integration (depends on Phase 1 + 3)
11. **Web types** -- Add `ThreadContextStatus` and `contextStatus` to `Thread`
12. **Web store** -- Map `contextStatus` in `syncServerReadModel`
13. **Web UI** -- `ContextStatusIndicator` component in composer footer

### Dependency Graph
```
Phase 1 (contracts)
    |
    +---> Phase 2 (persistence) ---> Phase 3 (processing)
    |                                      |
    +---> Phase 4 (adapters)               +---> Phase 5 (web)
```

Phases 2 and 4 can be developed in parallel. Phase 5 depends on Phase 3 being complete.

---

## Files to Create (NEW)

| File | Purpose |
|------|---------|
| `apps/server/src/persistence/Migrations/020_ProjectionThreadContextStatus.ts` | SQLite migration for new table |
| `apps/server/src/persistence/Services/ProjectionThreadContextStatus.ts` | Repository service interface |
| `apps/server/src/persistence/Layers/ProjectionThreadContextStatus.ts` | Repository SQL implementation |
| `packages/shared/src/contextWindow.ts` | Model context window registry |

## Files to Modify

| File | Change |
|------|--------|
| `packages/contracts/src/orchestration.ts` | Add `OrchestrationThreadContextStatus`, command, event schemas; add `contextStatus` to `OrchestrationThread` |
| `apps/server/src/persistence/Migrations.ts` | Register migration 020 |
| `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` | Add threadContextStatus projector, import repository |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` | Add contextStatus hydration query and assembly |
| `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` | Handle `thread.token-usage.updated`, dispatch `thread.context-status.set` |
| `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` | Emit `thread.token-usage.updated` events |
| `apps/server/src/provider/Layers/GeminiAdapter.ts` | Emit `thread.token-usage.updated` events |
| `packages/shared/package.json` | Add `./contextWindow` subpath export |
| `apps/web/src/types.ts` | Add `ThreadContextStatus` interface, add `contextStatus` to `Thread` |
| `apps/web/src/store.ts` | Map `contextStatus` in `syncServerReadModel` |
| `apps/web/src/components/ChatView.tsx` | Add `ContextStatusIndicator` to composer footer |

---

## Sources

- Direct codebase analysis: `packages/contracts/src/orchestration.ts` (1182 lines, full schema)
- Direct codebase analysis: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` (full projector pattern)
- Direct codebase analysis: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` (snapshot hydration pattern)
- Direct codebase analysis: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` (event processing pattern)
- Direct codebase analysis: `packages/contracts/src/providerRuntime.ts` (runtime event types, `ThreadTokenUsageUpdatedPayload`)
- Direct codebase analysis: `apps/server/src/provider/Layers/CodexAdapter.ts` (existing token usage emission)
- Direct codebase analysis: `apps/server/src/provider/Layers/ClaudeCodeAdapter.ts` (no token usage emission)
- Direct codebase analysis: `apps/server/src/provider/Layers/GeminiAdapter.ts` (no token usage emission)
- Direct codebase analysis: `apps/web/src/store.ts` (Zustand sync pattern)
- Direct codebase analysis: `apps/web/src/types.ts` (web Thread type)
- Direct codebase analysis: `apps/web/src/components/ChatView.tsx` (composer footer layout)
- Direct codebase analysis: `apps/server/src/persistence/Services/ProjectionThreadSessions.ts` (repository pattern reference)
- Direct codebase analysis: `apps/server/src/persistence/Layers/ProjectionThreadSessions.ts` (layer implementation reference)
- Direct codebase analysis: `apps/server/src/persistence/Migrations.ts` (migration registration pattern)
- Direct codebase analysis: `packages/contracts/src/model.ts` (model catalog for context window lookup)
