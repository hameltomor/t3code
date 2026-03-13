# Phase 9: Server Pipeline and Persistence - Research

**Researched:** 2026-03-13
**Domain:** Event-sourced projection pipeline, SQLite persistence, WebSocket push, Effect TS services
**Confidence:** HIGH

## Summary

Phase 9 wires token usage events through the full server pipeline: ingestion, context status computation, projection persistence, snapshot hydration, and WebSocket push. The upstream schemas (Phase 7) and provider adapters (Phase 8) are complete -- all three providers emit typed `thread.token-usage.updated` events with `NormalizedTokenUsage` payloads, and the `thread.context-status.set` command and `thread.context-status-set` event are already defined in contracts and handled by the decider. The in-memory projector currently ignores `thread.context-status-set` (falls through to default), and `ProjectionSnapshotQuery` hardcodes `contextStatus: null`.

The codebase follows a well-established event-sourcing pattern: `ProviderRuntimeIngestion` consumes provider runtime events, dispatches orchestration commands to `OrchestrationEngine`, which persists events and runs them through `ProjectionPipeline` (sequential projectors with per-projector cursor tracking via `projection_state`). `ProjectionSnapshotQuery` hydrates the `OrchestrationReadModel` from projection tables. Domain events are broadcast to WebSocket clients via `PubSub`. Phase 9 needs to add a new link in this chain: receive `thread.token-usage.updated` in ingestion, compute context status using the context window registry, dispatch `thread.context-status.set`, persist in a new projection table, and hydrate from snapshot query.

**Primary recommendation:** Follow the existing projection patterns exactly -- new projector name, new repository service/layer, new migration, new snapshot query join -- but mark the new projector as supplementary (not in `REQUIRED_SNAPSHOT_PROJECTORS`) and add ingestion-side dedup/throttle to prevent high-frequency token events from overwhelming the dispatch queue.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Effect | 3.x | Service architecture, Effect.gen, Layer, Schema, Queue, Cache, PubSub | Already used throughout; all pipeline components are Effect services |
| effect/unstable/sql | 3.x | SQLite persistence via SqlClient, SqlSchema, Migrator | All existing migrations and repositories use this |
| @xbetools/contracts | workspace | Shared schemas: OrchestrationThreadContextStatus, NormalizedTokenUsage, ProviderRuntimeEvent | Canonical source of truth for all types |
| @xbetools/shared/model | workspace | Context window registry: getContextWindowLimit() | Pure function, returns null for unknown models |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @effect/vitest | workspace | Test layer integration (it.layer, it.effect) | All projection/pipeline tests |
| Vitest | workspace | Test runner | `bun run test` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite projection table | In-memory only | Loses persistence across restarts; context status would reset |
| Per-event dispatch to engine | Batch/aggregate then dispatch | More complex; existing pattern is per-event dispatch with dedup |
| Effect Schedule throttle | Manual timestamp dedup | Effect Schedule is more powerful but the ingestion already uses a sequential queue; simple timestamp-based dedup is sufficient and more predictable |

## Architecture Patterns

### Recommended File Structure
```
apps/server/src/
  orchestration/
    Layers/
      ProjectionPipeline.ts           # ADD: contextStatus projector
      ProjectionSnapshotQuery.ts       # MODIFY: hydrate contextStatus
      ProviderRuntimeIngestion.ts      # MODIFY: handle token-usage.updated
    projector.ts                       # MODIFY: handle thread.context-status-set in-memory
    Schemas.ts                         # ADD: ThreadContextStatusSetPayload alias
  persistence/
    Migrations/
      020_ProjectionThreadContextStatus.ts  # NEW: migration
    Migrations.ts                      # MODIFY: register migration
    Services/
      ProjectionThreadContextStatus.ts # NEW: repository service interface
    Layers/
      ProjectionThreadContextStatus.ts # NEW: repository layer implementation
  provider/
    normalization/
      contextStatusComputation.ts      # NEW: pure function to compute context status
```

### Pattern 1: Projection Repository (Service + Layer)
**What:** Each projection table has a Service interface (defines the API) and a Layer implementation (uses SqlClient for SQL).
**When to use:** For every new projection table.
**Example:**
```typescript
// Service: apps/server/src/persistence/Services/ProjectionThreadContextStatus.ts
export const ProjectionThreadContextStatus = Schema.Struct({
  threadId: ThreadId,
  provider: ProviderKind,
  support: ContextStatusSupport,
  source: ContextStatusSource,
  freshness: ContextStatusFreshness,
  status: ContextStatusLevel,
  model: Schema.NullOr(Schema.String),
  tokenUsageJson: Schema.NullOr(Schema.String), // JSON-serialized NormalizedTokenUsage
  contextWindowLimit: Schema.NullOr(Schema.Number),
  percent: Schema.NullOr(Schema.Number),
  lastCompactedAt: Schema.NullOr(IsoDateTime),
  lastCompactionReason: Schema.NullOr(Schema.String),
  compactionCount: Schema.NullOr(Schema.Number),
  measuredAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export interface ProjectionThreadContextStatusRepositoryShape {
  readonly upsert: (row: ProjectionThreadContextStatus) => Effect<void, ProjectionRepositoryError>;
  readonly getByThreadId: (input) => Effect<Option<ProjectionThreadContextStatus>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (input) => Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadContextStatusRepository extends ServiceMap.Service<...>()(...) {}
```

### Pattern 2: Projector Registration in Pipeline
**What:** Each projector is a `ProjectorDefinition` with a name and an `apply` function. It's registered in the `projectors` array. The pipeline runs projectors sequentially and updates `projection_state` after each.
**When to use:** For every new projector.
**Example:**
```typescript
// In ProjectionPipeline.ts makeOrchestrationProjectionPipeline:
const applyContextStatusProjection: ProjectorDefinition["apply"] = (event) =>
  Effect.gen(function* () {
    if (event.type !== "thread.context-status-set") return;
    // upsert into projection_thread_context_status table
  });

// Register in projectors array:
{
  name: ORCHESTRATION_PROJECTOR_NAMES.threadContextStatus,
  apply: applyContextStatusProjection,
}
```

### Pattern 3: Snapshot Hydration
**What:** `ProjectionSnapshotQuery` loads all projection tables in a single transaction and assembles the `OrchestrationReadModel`.
**When to use:** To make projected data available to clients.
**Example:**
```typescript
// In ProjectionSnapshotQuery.ts:
const listContextStatusRows = SqlSchema.findAll({
  Request: Schema.Void,
  Result: ProjectionThreadContextStatusDbRowSchema,
  execute: () => sql`
    SELECT thread_id AS "threadId", ...
    FROM projection_thread_context_status
  `,
});

// In getSnapshot, add to Effect.all:
const contextStatusRows = yield* listContextStatusRows(undefined).pipe(...);

// Build contextStatusByThread map:
const contextStatusByThread = new Map<string, OrchestrationThreadContextStatus>();
for (const row of contextStatusRows) {
  contextStatusByThread.set(row.threadId, { ... });
}

// Use in thread assembly:
contextStatus: contextStatusByThread.get(row.threadId) ?? null,
```

### Pattern 4: Ingestion Token Usage Handling with Dedup
**What:** `ProviderRuntimeIngestion.processRuntimeEvent` handles `thread.token-usage.updated` by computing context status and dispatching `thread.context-status.set`. Uses timestamp-based dedup to throttle high-frequency events.
**When to use:** For the token usage to context status transformation.
**Example:**
```typescript
// In ProviderRuntimeIngestion.ts processRuntimeEvent:
if (event.type === "thread.token-usage.updated") {
  const contextStatus = computeContextStatus({
    provider: event.provider,
    model: thread.model,
    usage: event.payload.usage,
    support: event.payload.support,
    source: event.payload.source,
    measuredAt: event.createdAt,
  });
  if (contextStatus && shouldDispatchContextStatus(thread.id, contextStatus)) {
    yield* orchestrationEngine.dispatch({
      type: "thread.context-status.set",
      commandId: providerCommandId(event, "context-status-set"),
      threadId: thread.id,
      contextStatus,
      createdAt: event.createdAt,
    });
  }
}
```

### Pattern 5: Context Status Computation (Pure Function)
**What:** A pure function that takes token usage, model info, and context window limits and returns an `OrchestrationThreadContextStatus` object with computed `status` level and `percent`.
**When to use:** In ingestion, when computing context status from raw token events.
**Example:**
```typescript
// apps/server/src/provider/normalization/contextStatusComputation.ts
import { getContextWindowLimit } from "@xbetools/shared/model";

export function computeContextStatus(input: {
  provider: ProviderKind;
  model: string | null;
  usage: NormalizedTokenUsage;
  support: ContextStatusSupport;
  source: ContextStatusSource;
  measuredAt: string;
  previousStatus?: OrchestrationThreadContextStatus | null;
}): OrchestrationThreadContextStatus {
  const limit = getContextWindowLimit(input.model, input.provider);
  const maxInputTokens = limit?.maxInputTokens ?? null;
  const percent = maxInputTokens && input.usage.totalTokens !== undefined
    ? (input.usage.totalTokens / maxInputTokens) * 100
    : undefined;
  const status = computeStatusLevel(percent);
  return {
    provider: input.provider,
    support: input.support,
    source: input.source,
    freshness: "live",
    status,
    model: input.model,
    tokenUsage: input.usage,
    ...(maxInputTokens !== null ? { contextWindowLimit: maxInputTokens } : {}),
    ...(percent !== undefined ? { percent } : {}),
    measuredAt: input.measuredAt,
  };
}

function computeStatusLevel(percent: number | undefined): ContextStatusLevel {
  if (percent === undefined) return "unknown";
  if (percent >= 95) return "near-limit";
  if (percent >= 75) return "watch";
  return "ok";
}
```

### Anti-Patterns to Avoid
- **Blocking turn start/send on context status computation:** PIPE-08 requires that context status computation never blocks the turn lifecycle. The ingestion queue processes events sequentially, so a slow context status dispatch would block subsequent events. Keep computation pure and fast; if dispatch fails, log and continue.
- **Adding contextStatus projector to REQUIRED_SNAPSHOT_PROJECTORS:** PIPE-07 explicitly requires it NOT be in the required list. If the projector falls behind, snapshot reads should still succeed with `contextStatus: null`.
- **Persisting every single token event:** Codex emits token usage on every streaming chunk. Without throttle/dedup, this produces excessive writes and broadcasts. Must dedup by comparing against last dispatched value or using a minimum interval.
- **Breaking the sequential projector invariant:** All projectors in the pipeline run sequentially. Do not change this to concurrent for the new projector.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Context window limits lookup | Custom model-to-limit mapping | `getContextWindowLimit()` from `@xbetools/shared/model` | Already built in Phase 7; maintained centrally with alias resolution |
| Schema decode/validation | Manual type checks | `Schema.decodeUnknownSync` / `Schema.decodeUnknownEffect` | Existing pattern throughout projector.ts |
| Command dedup | Custom dedup table | `commandId` uniqueness via `OrchestrationCommandReceiptRepository` | Already built into OrchestrationEngine dispatch |
| SQL persistence | Raw SQL strings | `SqlSchema.void` / `SqlSchema.findAll` / `SqlSchema.findOneOption` | Existing pattern in all repository layers; provides automatic decode |

**Key insight:** The existing projection infrastructure handles everything except context status. The planner should NOT redesign the pipeline -- just add a new lane following the exact same patterns.

## Common Pitfalls

### Pitfall 1: Token Usage Event Flood
**What goes wrong:** Codex emits `thread.token-usage.updated` on every streaming token chunk, potentially hundreds per second during active turns. Without throttle, each dispatches a command, persists an event, runs all projectors, writes to SQLite, and broadcasts via WebSocket.
**Why it happens:** Token usage events fire at streaming frequency, not turn frequency.
**How to avoid:** Implement dedup in `ProviderRuntimeIngestion` before dispatching. Options: (a) Skip dispatch when `totalTokens` hasn't changed, (b) Use a minimum interval (e.g., 2-5 seconds) between dispatches per thread, (c) Only dispatch on meaningful status level changes.
**Warning signs:** SQLite write amplification, WebSocket message queue backlog, UI re-render storms.

### Pitfall 2: Stale Context Status After Restart
**What goes wrong:** After server restart, the in-memory projector starts fresh. If contextStatus is only in memory, it's lost. If only in the projection table, the snapshot query must hydrate it.
**Why it happens:** The in-memory projector (`projector.ts`) currently doesn't handle `thread.context-status-set`.
**How to avoid:** Both the in-memory projector AND the projection table must be updated. The in-memory projector provides live read model updates; the projection table provides persistence across restarts via `ProjectionSnapshotQuery`.

### Pitfall 3: Missing Compaction Detection
**What goes wrong:** Claude Code emits `compact_boundary` events that indicate context compaction. If context status only looks at totalTokens, it may show high usage right before compaction resets the count.
**Why it happens:** `compact_boundary` events from Phase 8 emit a separate `thread.token-usage.updated` with reduced token count. The status should reflect this as "compacted".
**How to avoid:** The `computeContextStatus` function should detect compaction by comparing previous totalTokens with current -- if current is significantly lower, set `status: "compacted"` and populate compaction metadata fields.

### Pitfall 4: Snapshot Decode Failure on Schema Mismatch
**What goes wrong:** If the projection table schema doesn't match the `OrchestrationThreadContextStatus` Effect schema, snapshot hydration fails for ALL threads.
**Why it happens:** Mismatched column types, missing nullable annotations, or incorrect JSON serialization of tokenUsage.
**How to avoid:** Use `Schema.NullOr` and `withDecodingDefault(null)` on the contextStatus field (already done in Phase 7). Store tokenUsage as JSON text in SQLite and decode with `Schema.fromJsonString`. Test hydration with realistic data fixtures.

### Pitfall 5: Migration Ordering Conflict
**What goes wrong:** New migration number conflicts with another developer's branch.
**Why it happens:** Sequential migration numbering (020) can clash.
**How to avoid:** Check the highest existing migration number at implementation time. Currently at 019. Use 020.

## Code Examples

### Existing Projector Pattern (from `ProjectionPipeline.ts`)
```typescript
// Source: apps/server/src/orchestration/Layers/ProjectionPipeline.ts lines 764-781
const applyThreadSessionsProjection: ProjectorDefinition["apply"] = (event) =>
  Effect.gen(function* () {
    if (event.type !== "thread.session-set") return;
    yield* projectionThreadSessionRepository.upsert({
      threadId: event.payload.threadId,
      status: event.payload.session.status,
      providerName: event.payload.session.providerName,
      runtimeMode: event.payload.session.runtimeMode,
      activeTurnId: event.payload.session.activeTurnId,
      lastError: event.payload.session.lastError,
      updatedAt: event.payload.session.updatedAt,
    });
  });
```

### Existing Migration Pattern (from `013_ProjectionThreadProposedPlans.ts`)
```typescript
// Source: apps/server/src/persistence/Migrations/013_ProjectionThreadProposedPlans.ts
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_proposed_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      plan_markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_proposed_plans_thread_created
    ON projection_thread_proposed_plans(thread_id, created_at)
  `;
});
```

### Existing Repository Layer Pattern (from `ProjectionThreadSessions.ts`)
```typescript
// Source: apps/server/src/persistence/Layers/ProjectionThreadSessions.ts lines 15-49
const makeProjectionThreadSessionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadSession,
    execute: (row) => sql`
      INSERT INTO projection_thread_sessions (thread_id, status, ...)
      VALUES (${row.threadId}, ${row.status}, ...)
      ON CONFLICT (thread_id)
      DO UPDATE SET status = excluded.status, ...
    `,
  });
  // ...
});
```

### Existing Snapshot Hydration Pattern (from `ProjectionSnapshotQuery.ts`)
```typescript
// Source: apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts lines 538-559
const threads: Array<OrchestrationThread> = threadRows.map((row) => ({
  id: row.threadId,
  // ... other fields ...
  session: sessionsByThread.get(row.threadId) ?? null,
  contextStatus: null,  // <-- THIS is what Phase 9 changes
}));
```

### Existing In-Memory Projector Pattern (from `projector.ts`)
```typescript
// Source: apps/server/src/orchestration/projector.ts, similar to runtime-mode-set handling
case "thread.runtime-mode-set":
  return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
    Effect.map((payload) => ({
      ...nextBase,
      threads: updateThread(nextBase.threads, payload.threadId, {
        runtimeMode: payload.runtimeMode,
        updatedAt: payload.updatedAt,
      }),
    })),
  );
```

### Existing Ingestion Event Handling Pattern (from `ProviderRuntimeIngestion.ts`)
```typescript
// Source: apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts lines 1093-1100
if (event.type === "thread.metadata.updated" && event.payload.name) {
  yield* orchestrationEngine.dispatch({
    type: "thread.meta.update",
    commandId: providerCommandId(event, "thread-meta-update"),
    threadId: thread.id,
    title: event.payload.name,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Schema.Unknown` for token usage payload | Typed `ThreadTokenUsageUpdatedPayload` with `NormalizedTokenUsage` | Phase 7/8 (March 2026) | All provider events now carry typed usage data |
| No context status | `OrchestrationThreadContextStatus` schema with enums | Phase 7 (March 2026) | Schema exists but is not populated (always null) |
| `contextStatus: null` hardcoded in snapshot | Needs hydration from projection table | Phase 9 (this phase) | Will make context status available to all clients |

**Deprecated/outdated:**
- `providerRuntime.ts` previously used `Schema.Unknown` for `ThreadTokenUsageUpdatedPayload` -- replaced in Phase 8 with typed `NormalizedTokenUsage`, `ContextStatusSupport`, `ContextStatusSource`.

## Open Questions

1. **Throttle strategy specifics**
   - What we know: Token usage events can fire at streaming frequency (multiple per second). The dispatch queue processes sequentially.
   - What's unclear: What is the optimal throttle interval? What dedup strategy works best -- time-based, value-based (totalTokens changed), or status-level-change-based?
   - Recommendation: Use a combination -- minimum 2-second interval between dispatches per thread AND skip dispatch when totalTokens hasn't changed. This covers both Codex (high-frequency identical values) and Claude Code (less frequent but large changes).

2. **Compaction detection heuristic**
   - What we know: Claude Code emits `compact_boundary` with reduced token counts. The `support` field is "derived-live" and `source` is "sdk-usage" for both regular and compaction events.
   - What's unclear: Should we track compaction count and reason in ingestion, or just detect the pattern from token count drops?
   - Recommendation: Track previous contextStatus per thread in ingestion state. When totalTokens drops significantly (e.g., > 20% decrease), set `status: "compacted"`, increment `compactionCount`, and set `lastCompactedAt`. The Phase 8 `compact_boundary` already sets specific metadata; use the `source` field to disambiguate.

3. **Integration test boundary**
   - What we know: TEST-04 requires an end-to-end integration test: provider event -> ingestion -> projection -> snapshot -> WebSocket push.
   - What's unclear: How to test WebSocket push in a unit test? The existing `ProviderRuntimeIngestion.test.ts` uses a harness that mocks the provider service stream.
   - Recommendation: Extend the existing `ProviderRuntimeIngestion.test.ts` harness pattern. Emit a `thread.token-usage.updated` event, wait for the read model to have contextStatus populated, then verify the projection table and snapshot query. WebSocket push is verified by checking the PubSub-published domain events contain the `thread.context-status-set` event.

## Sources

### Primary (HIGH confidence)
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` -- Full projection pipeline implementation, projector registration pattern
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` -- Snapshot hydration pattern, REQUIRED_SNAPSHOT_PROJECTORS list
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` -- Runtime event ingestion, dispatch pattern
- `apps/server/src/orchestration/projector.ts` -- In-memory read model projector
- `apps/server/src/orchestration/decider.ts` -- Command->event decision, `thread.context-status.set` already handled (line 660-680)
- `apps/server/src/persistence/Layers/ProjectionThreadSessions.ts` -- Repository layer pattern
- `apps/server/src/persistence/Services/ProjectionThreadSessions.ts` -- Repository service interface pattern
- `apps/server/src/persistence/Migrations/013_ProjectionThreadProposedPlans.ts` -- Migration pattern
- `packages/contracts/src/orchestration.ts` -- All schemas: OrchestrationThreadContextStatus, ThreadContextStatusSetPayload, NormalizedTokenUsage
- `packages/contracts/src/providerRuntime.ts` -- ProviderRuntimeEvent, ThreadTokenUsageUpdatedPayload
- `packages/shared/src/model.ts` -- getContextWindowLimit(), context window registry
- `apps/server/src/provider/normalization/tokenUsageNormalization.ts` -- Normalization functions from Phase 8
- `.planning/phases/08-provider-normalization/08-VERIFICATION.md` -- Phase 8 verification confirming all adapters emit typed events

### Secondary (MEDIUM confidence)
- Existing test files (`ProjectionPipeline.test.ts`, `ProjectionSnapshotQuery.test.ts`, `ProviderRuntimeIngestion.test.ts`) -- Test patterns and layer setup

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries/patterns are already established in the codebase; no new dependencies needed
- Architecture: HIGH -- Every component follows an existing, well-documented pattern with multiple examples
- Pitfalls: HIGH -- Token usage flood, stale state, and migration ordering are observable from code inspection
- Context status computation: MEDIUM -- The specific thresholds (75%/95%) and compaction detection heuristic need validation during implementation

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable internal architecture, no external dependencies)
