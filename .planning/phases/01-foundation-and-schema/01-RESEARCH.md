# Phase 1: Foundation and Schema - Research

**Researched:** 2026-03-12
**Domain:** Effect Schema contracts, SQLite migrations, Effect repository services, WebSocket method routing
**Confidence:** HIGH (all findings derived directly from codebase analysis -- no external libraries or APIs involved)

## Summary

Phase 1 delivers the shared types, database tables, and repository services that all subsequent history import phases build against. The work spans three packages (`packages/contracts`, `apps/server/src/persistence`, `apps/server/src/wsServer.ts`) and introduces two new SQLite tables plus a schema extension to the existing `OrchestrationThread` read model.

The codebase already has a well-established pattern for every artifact this phase requires: Effect `Schema.Struct` for contracts, `Migrator.fromRecord` for SQLite migrations, `ServiceMap.Service` + `Layer.effect` for repositories, and tagged-union request routing in `wsServer.ts`. Phase 1 follows these patterns exactly -- no new libraries, no architectural deviations.

**Primary recommendation:** Follow the existing `draft.ts` / `notification.ts` contract pattern exactly. Follow the existing `016_ProjectionDrafts.ts` migration pattern exactly. Follow the existing `ProjectionDraftRepository` service/layer split exactly. The planner should produce tasks that add each artifact using the nearest existing analog as a template.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `effect` | `catalog:` (workspace) | Schema definitions, Effect services, Layer composition | Already used everywhere in contracts and server |
| `effect/unstable/sql/SqlClient` | Same | SQL queries in repository layers | Used by every existing repository |
| `effect/unstable/sql/SqlSchema` | Same | Typed SQL query builders (`findAll`, `findOneOption`, `void`) | Used by every existing repository |
| `effect/unstable/sql/Migrator` | Same | Migration runner with `fromRecord` | Used in `persistence/Migrations.ts` |

### Supporting

No additional libraries needed. All requirements are met by the existing Effect ecosystem already in the workspace.

### Alternatives Considered

None. Phase 1 introduces no new dependencies. Every artifact uses the same tooling as the existing codebase.

## Architecture Patterns

### Recommended Project Structure

```
packages/contracts/src/
  historyImport.ts          # NEW: all import enums, schemas, WS methods, input/output types
  index.ts                  # ADD: export * from "./historyImport"
  orchestration.ts          # MODIFY: add providerThreadId to OrchestrationThread,
                            #   ThreadCreateCommand, ThreadCreatedPayload

apps/server/src/
  persistence/
    Migrations/
      017_HistoryImportCatalog.ts    # NEW: history_import_catalog table
      018_ThreadExternalLinks.ts     # NEW: thread_external_links table
      019_ProjectionThreadsProviderThreadId.ts  # NEW: ALTER TABLE projection_threads
                                               #   ADD COLUMN provider_thread_id
    Migrations.ts            # MODIFY: register 017, 018, 019
    Services/
      HistoryImportCatalog.ts        # NEW: service interface
      ThreadExternalLinks.ts         # NEW: service interface
    Layers/
      HistoryImportCatalog.ts        # NEW: SQLite implementation
      ThreadExternalLinks.ts         # NEW: SQLite implementation
    Errors.ts                # MODIFY: add error type aliases
  wsServer.ts                # MODIFY: add historyImport.* route stubs
```

### Pattern 1: Effect Schema Contract Module

**What:** A new `historyImport.ts` file in `packages/contracts/src/` defines all enums, record schemas, input schemas, output schemas, and WS method constants. It is re-exported from `index.ts`.
**When to use:** Always when adding a new WS domain.
**Example (from `draft.ts`):**
```typescript
// packages/contracts/src/historyImport.ts
import { Schema } from "effect";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const HISTORY_IMPORT_WS_METHODS = {
  list: "historyImport.list",
  preview: "historyImport.preview",
  execute: "historyImport.execute",
  validateLink: "historyImport.validateLink",
  listThreadLinks: "historyImport.listThreadLinks",
} as const;

export const HistoryImportProvider = Schema.Literals(["codex", "claudeCode", "gemini"]);
export type HistoryImportProvider = typeof HistoryImportProvider.Type;

// ... rest of schemas
```

### Pattern 2: Migration File Structure

**What:** Each migration is a default-exported `Effect.gen` that yields `SqlClient.SqlClient` and executes raw SQL statements.
**When to use:** Every new table or schema change.
**Example (from `016_ProjectionDrafts.ts`):**
```typescript
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS history_import_catalog (
      catalog_id TEXT PRIMARY KEY,
      ...
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_history_import_catalog_workspace
    ON history_import_catalog(workspace_root, provider_name)
  `;
});
```

### Pattern 3: Migration Registration

**What:** Migrations are imported statically and registered in `Migrations.ts` via `Migrator.fromRecord` with keys formatted as `"{id}_{Name}"`.
**When to use:** Every new migration file.
**Example (from `Migrations.ts`):**
```typescript
import Migration0017 from "./Migrations/017_HistoryImportCatalog.ts";
import Migration0018 from "./Migrations/018_ThreadExternalLinks.ts";
import Migration0019 from "./Migrations/019_ProjectionThreadsProviderThreadId.ts";

const loader = Migrator.fromRecord({
  // ... existing entries ...
  "17_HistoryImportCatalog": Migration0017,
  "18_ThreadExternalLinks": Migration0018,
  "19_ProjectionThreadsProviderThreadId": Migration0019,
});
```

### Pattern 4: Service Interface + Layer Implementation Split

**What:** `Services/Xxx.ts` defines the Schema struct, input schemas, `interface XxxShape`, and `class Xxx extends ServiceMap.Service`. `Layers/Xxx.ts` implements it with `Effect.gen` + `SqlSchema` queries + `Layer.effect`.
**When to use:** Every new repository.
**Example (from `ProjectionDraftRepository`):**
```typescript
// Services/HistoryImportCatalog.ts
export const HistoryImportCatalogEntry = Schema.Struct({ ... });
export interface HistoryImportCatalogRepositoryShape { ... }
export class HistoryImportCatalogRepository extends ServiceMap.Service<
  HistoryImportCatalogRepository,
  HistoryImportCatalogRepositoryShape
>()("xbe/persistence/Services/HistoryImportCatalog/HistoryImportCatalogRepository") {}

// Layers/HistoryImportCatalog.ts
const makeRepository = Effect.gen(function* () { ... });
export const HistoryImportCatalogRepositoryLive = Layer.effect(
  HistoryImportCatalogRepository,
  makeRepository,
);
```

### Pattern 5: WS Method Routing in wsServer.ts

**What:** New WS methods require: (1) adding entries to `WS_METHODS` in `ws.ts`, (2) adding tagged request body entries to `WebSocketRequestBody` in `ws.ts`, (3) adding case handlers in `routeRequest` switch in `wsServer.ts`.
**When to use:** Every new WS method domain.
**Example pattern for stubs:**
```typescript
// In wsServer.ts routeRequest switch:
case WS_METHODS.historyImportList: {
  return yield* new RouteRequestError({
    message: "historyImport.list is not yet implemented",
  });
}
```

### Pattern 6: providerThreadId on OrchestrationThread

**What:** Add `providerThreadId: Schema.NullOr(TrimmedNonEmptyString)` to `OrchestrationThread`, `ThreadCreateCommand`, and `ThreadCreatedPayload` in `orchestration.ts`. Add a corresponding `provider_thread_id TEXT` column to `projection_threads` (via ALTER TABLE migration). Update the projection pipeline to persist it. Update the snapshot query to read it.
**When to use:** This is a one-time schema extension required for deduplication and native resume.
**Key consideration:** The `projection_thread_sessions` table already has a `provider_thread_id` column (from migration 005), but that is session-scoped runtime state. The new `providerThreadId` on `OrchestrationThread` is the durable, thread-level field that persists independent of session lifecycle.

### Anti-Patterns to Avoid

- **Reusing `provider_session_runtime` for import state:** This table has session-scoped lifecycle (deleted on session end). Import metadata must survive session restarts. Use dedicated `thread_external_links` table.
- **Adding import columns to `projection_threads`:** Import-specific state (source path, fingerprint, validation status) belongs in `thread_external_links`, not in the projection thread row. Only `providerThreadId` goes on the thread itself.
- **Skipping the contracts package:** All schemas must be in `packages/contracts/src/historyImport.ts` so the web app can consume them. Do not define schemas server-side only.
- **Using `Schema.optional` where `Schema.NullOr` is needed:** For SQLite columns that can be NULL, use `Schema.NullOr`. `Schema.optional` means "field may be omitted from the object", which is different from "field present but null". Follow the existing pattern on `OrchestrationThread` (e.g., `branch: Schema.NullOr(TrimmedNonEmptyString)`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL query builders | Custom SQL string concatenation | `SqlSchema.void`, `SqlSchema.findAll`, `SqlSchema.findOneOption` | Type-safe, handles parameter binding, consistent error mapping |
| Migration running | Manual `CREATE TABLE` in startup code | `Migrator.fromRecord` + `Migrator.make` | Tracks applied migrations, handles ordering, idempotent |
| Service dependency injection | Manual constructor injection | `ServiceMap.Service` + `Layer.effect` + `Layer.provide` | Full Effect ecosystem integration, testability, composability |
| Schema validation | Manual `typeof` / `instanceof` checks | `Schema.decodeUnknownEffect` / `Schema.encodeEffect` | Composable, error-reporting, same schema for encode/decode |
| WS request routing | String matching on method names | Tagged union via `Schema.tag` + exhaustive switch | Compile-time exhaustiveness checking, type-narrowed body |

**Key insight:** The existing codebase already provides the infrastructure for everything Phase 1 needs. The only "new" work is defining the specific schemas, tables, and routes -- not building any new infrastructure.

## Common Pitfalls

### Pitfall 1: Migration Number Collision

**What goes wrong:** Two developers add migrations with the same number, causing `Migrator.fromRecord` key conflict.
**Why it happens:** Migration numbers are manually assigned.
**How to avoid:** The next available numbers are 017, 018, 019. The phase creates exactly three migrations. Reserve these numbers in the migration loader immediately.
**Warning signs:** TypeScript compilation error from duplicate keys in `Migrator.fromRecord`.

### Pitfall 2: Forgetting to Register Migration in Migrations.ts

**What goes wrong:** Migration file exists but never runs because it's not imported and added to `fromRecord`.
**Why it happens:** The migration loader uses static imports, not filesystem scanning.
**How to avoid:** Every migration file must have a corresponding import line and `fromRecord` entry in `Migrations.ts`.
**Warning signs:** Table doesn't exist at runtime despite migration file existing.

### Pitfall 3: Column Name / Schema Field Mismatch

**What goes wrong:** SQLite column uses `snake_case` but the `SELECT ... AS` alias doesn't match the Schema struct field name in `camelCase`.
**Why it happens:** Manual aliasing in SQL queries.
**How to avoid:** Follow the exact pattern from existing repositories: `provider_thread_id AS "providerThreadId"`. Note the double quotes around the alias.
**Warning signs:** `PersistenceDecodeError` at runtime when reading rows.

### Pitfall 4: Forgetting to Update the Exhaustive Switch in wsServer.ts

**What goes wrong:** Adding new entries to `WebSocketRequestBody` union but not adding corresponding `case` handlers in `routeRequest`. TypeScript compilation fails with "Type X is not assignable to never".
**Why it happens:** The switch in `wsServer.ts` uses `const _exhaustiveCheck: never = request.body` at the end.
**How to avoid:** Every new `tagRequestBody` entry in `ws.ts` must have a corresponding `case` in `routeRequest`.
**Warning signs:** TypeScript error on the `default` branch of the switch.

### Pitfall 5: providerThreadId Schema Cascade

**What goes wrong:** Adding `providerThreadId` to `OrchestrationThread` but forgetting to update `ThreadCreateCommand`, `ThreadCreatedPayload`, `ProjectionThread`, the projection pipeline's `applyThreadsProjection`, and the snapshot query's thread row assembly.
**Why it happens:** The field touches 6+ locations across contracts and server.
**How to avoid:** Trace the full lifecycle: Command -> Event payload -> Projection write -> Projection read -> Snapshot assembly -> Read model. Every step must carry the field.
**Warning signs:** Schema validation errors, missing data in the web client's thread object.

### Pitfall 6: Unique Index on provider_thread_id Must Allow NULLs

**What goes wrong:** Creating a UNIQUE index on `provider_thread_id` in `projection_threads` causes conflicts when multiple native threads have NULL provider_thread_id.
**Why it happens:** SQLite handles NULLs in unique indexes differently from other databases. In SQLite, each NULL is considered distinct, so UNIQUE actually works correctly with NULLs. But a UNIQUE constraint on the column alone is not useful for deduplication -- you need a composite check.
**How to avoid:** The dedup query should be a lookup: `WHERE provider_thread_id = ? AND provider_thread_id IS NOT NULL`. A partial unique index (`CREATE UNIQUE INDEX ... WHERE provider_thread_id IS NOT NULL`) is the correct approach.
**Warning signs:** Duplicate threads for the same provider session, or constraint errors on native thread creation.

### Pitfall 7: WS Contracts Need Both Constants AND Tagged Bodies

**What goes wrong:** Adding method constants to `WS_METHODS` but forgetting to add `tagRequestBody` entries to `WebSocketRequestBody`, or vice versa.
**Why it happens:** Two separate locations must be updated in `ws.ts`.
**How to avoid:** For each new WS method: (1) add to `WS_METHODS` constant, (2) add `tagRequestBody` to `WebSocketRequestBody` union, (3) add input schema in `historyImport.ts`, (4) import input schema in `ws.ts`.
**Warning signs:** TypeScript errors in `ws.ts`, or requests silently rejected as "Invalid request format" at runtime.

### Pitfall 8: ServerRuntimeServices Type Must Include New Repositories

**What goes wrong:** New repository services are created but not added to the `ServerRuntimeServices` type union in `wsServer.ts`, causing type errors when the route handler tries to use them.
**Why it happens:** Phase 1 only adds stubs (returning errors), so the repositories aren't actually needed yet. But if they're wired into the layer graph in `serverLayers.ts`, the types must align.
**How to avoid:** For Phase 1 stubs, the route handlers should NOT depend on the repository services. They should return `RouteRequestError` directly. Repository wiring comes in Phase 2.
**Warning signs:** Type errors in `wsServer.ts` about missing services in the Effect context.

## Code Examples

Verified patterns from the existing codebase:

### Creating a New Contract Module (from `draft.ts`)

```typescript
// packages/contracts/src/historyImport.ts
import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const HISTORY_IMPORT_WS_METHODS = {
  list: "historyImport.list",
  preview: "historyImport.preview",
  execute: "historyImport.execute",
  validateLink: "historyImport.validateLink",
  listThreadLinks: "historyImport.listThreadLinks",
} as const;

export const HistoryImportProvider = Schema.Literals(["codex", "claudeCode", "gemini"]);
export type HistoryImportProvider = typeof HistoryImportProvider.Type;

export const HistoryImportLinkMode = Schema.Literals([
  "native-resume",
  "transcript-replay",
  "snapshot-only",
]);
export type HistoryImportLinkMode = typeof HistoryImportLinkMode.Type;

export const HistoryImportValidationStatus = Schema.Literals([
  "unknown",
  "valid",
  "missing",
  "stale",
  "invalid",
]);
export type HistoryImportValidationStatus = typeof HistoryImportValidationStatus.Type;
```

### Creating a Migration (from `016_ProjectionDrafts.ts`)

```typescript
// apps/server/src/persistence/Migrations/017_HistoryImportCatalog.ts
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS history_import_catalog (
      catalog_id           TEXT PRIMARY KEY,
      provider_name        TEXT NOT NULL,
      workspace_root       TEXT NOT NULL,
      cwd                  TEXT NOT NULL,
      title                TEXT NOT NULL,
      ...
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_history_import_catalog_workspace
    ON history_import_catalog(workspace_root, provider_name)
  `;
});
```

### Creating a Repository Service Interface (from `ProjectionDrafts.ts`)

```typescript
// apps/server/src/persistence/Services/HistoryImportCatalog.ts
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";
import type { ProjectionRepositoryError } from "../Errors.ts";

export const HistoryImportCatalogEntry = Schema.Struct({
  catalogId: Schema.String,
  providerName: Schema.String,
  workspaceRoot: Schema.String,
  // ... all fields
});
export type HistoryImportCatalogEntry = typeof HistoryImportCatalogEntry.Type;

export interface HistoryImportCatalogRepositoryShape {
  readonly upsert: (
    entry: HistoryImportCatalogEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  // ... other methods
}

export class HistoryImportCatalogRepository extends ServiceMap.Service<
  HistoryImportCatalogRepository,
  HistoryImportCatalogRepositoryShape
>()("xbe/persistence/Services/HistoryImportCatalog/HistoryImportCatalogRepository") {}
```

### Creating a Repository Layer Implementation (from `ProjectionDrafts.ts`)

```typescript
// apps/server/src/persistence/Layers/HistoryImportCatalog.ts
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";
import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  HistoryImportCatalogEntry,
  HistoryImportCatalogRepository,
  type HistoryImportCatalogRepositoryShape,
} from "../Services/HistoryImportCatalog.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: HistoryImportCatalogEntry,
    execute: (row) => sql`
      INSERT INTO history_import_catalog (catalog_id, ...)
      VALUES (${row.catalogId}, ...)
      ON CONFLICT (catalog_id)
      DO UPDATE SET ...
    `,
  });

  // ... implement all shape methods

  return { upsert, ... } satisfies HistoryImportCatalogRepositoryShape;
});

export const HistoryImportCatalogRepositoryLive = Layer.effect(
  HistoryImportCatalogRepository,
  makeRepository,
);
```

### Adding WS Method Stubs (from existing wsServer.ts pattern)

```typescript
// In ws.ts -- add to WS_METHODS:
import { HISTORY_IMPORT_WS_METHODS, HistoryImportListInput, ... } from "./historyImport";

export const WS_METHODS = {
  // ... existing methods ...
  historyImportList: HISTORY_IMPORT_WS_METHODS.list,
  historyImportPreview: HISTORY_IMPORT_WS_METHODS.preview,
  historyImportExecute: HISTORY_IMPORT_WS_METHODS.execute,
  historyImportValidateLink: HISTORY_IMPORT_WS_METHODS.validateLink,
  historyImportListThreadLinks: HISTORY_IMPORT_WS_METHODS.listThreadLinks,
} as const;

// In ws.ts -- add to WebSocketRequestBody union:
tagRequestBody(WS_METHODS.historyImportList, HistoryImportListInput),
// ... etc

// In wsServer.ts -- add to routeRequest switch:
case WS_METHODS.historyImportList:
  return yield* new RouteRequestError({
    message: "historyImport.list is not yet implemented",
  });
```

### Extending OrchestrationThread with providerThreadId

```typescript
// In orchestration.ts -- OrchestrationThread:
export const OrchestrationThread = Schema.Struct({
  // ... existing fields ...
  providerThreadId: Schema.NullOr(TrimmedNonEmptyString),  // NEW
  // ... rest of fields ...
});

// In orchestration.ts -- ThreadCreateCommand:
const ThreadCreateCommand = Schema.Struct({
  // ... existing fields ...
  providerThreadId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),  // NEW, defaults to null for backwards compatibility
  // ... rest of fields ...
});

// In orchestration.ts -- ThreadCreatedPayload:
export const ThreadCreatedPayload = Schema.Struct({
  // ... existing fields ...
  providerThreadId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),  // NEW, defaults to null for backwards compatibility
  // ... rest of fields ...
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct projection table writes | All ingestion through `OrchestrationEngine.dispatch` | Project architecture from day 1 | Import must go through the same command dispatch path |
| Runtime session state for all provider metadata | Separate `provider_session_runtime` for live sessions only | Architecture decision | Import link metadata goes in dedicated table, not runtime state |

**Deprecated/outdated:**
- None relevant to Phase 1. All patterns in use are current.

## Open Questions

1. **providerThreadId migration: ALTER TABLE vs recreate?**
   - What we know: SQLite supports `ALTER TABLE ... ADD COLUMN` for adding nullable columns with defaults. The existing codebase uses ALTER TABLE in migrations (e.g., `015_WorkspaceWorktreeEntries.ts`).
   - What's unclear: Whether `provider_thread_id` should have a default of `NULL` (matching the `Schema.NullOr` in contracts).
   - Recommendation: Use `ALTER TABLE projection_threads ADD COLUMN provider_thread_id TEXT` (NULL default is implicit in SQLite). This matches the pattern in migration 015. The unique partial index goes in the same migration.

2. **Migration 017 vs 018 ordering: does it matter?**
   - What we know: The two tables (`history_import_catalog` and `thread_external_links`) have no foreign key relationship between them. Either can be created first.
   - What's unclear: Nothing.
   - Recommendation: Order by logical dependency: catalog first (017), external links second (018), providerThreadId column third (019). This matches the REQUIREMENTS.md numbering.

3. **Should WS stubs be in Phase 1 or Phase 2?**
   - What we know: The success criteria explicitly say "WS method stubs for historyImport.list, historyImport.preview, historyImport.execute, historyImport.validateLink, and historyImport.listThreadLinks are routed in wsServer.ts (returning not-implemented errors is acceptable)."
   - What's unclear: Nothing -- stubs are explicitly in Phase 1.
   - Recommendation: Add stubs returning `RouteRequestError("not yet implemented")` in Phase 1. Real implementations come in Phase 2.

4. **Number of migrations: 2 (017, 018) or 3 (017, 018, 019)?**
   - What we know: The ROADMAP says migrations 017 and 018 for the two new tables. But `providerThreadId` also needs a column added to `projection_threads`, which is a separate DDL operation.
   - What's unclear: Whether the `providerThreadId` ALTER TABLE should be part of migration 017 or 018, or a separate migration 019.
   - Recommendation: Use a separate migration 019 for `ALTER TABLE projection_threads ADD COLUMN provider_thread_id TEXT` plus the partial unique index. This keeps each migration focused on one table and avoids coupling the new tables with the schema extension. The ROADMAP's numbering (017, 018) is a guideline not a constraint.

## Sources

### Primary (HIGH confidence)

- **Codebase: `packages/contracts/src/orchestration.ts`** -- All existing command/event/read-model schemas, `OrchestrationThread`, `ThreadCreateCommand`, `ThreadCreatedPayload`. Confirmed `providerThreadId` does NOT yet exist on these schemas.
- **Codebase: `packages/contracts/src/ws.ts`** -- `WS_METHODS`, `WebSocketRequestBody` tagged union, `tagRequestBody` helper, `WebSocketRequest`/`WebSocketResponse` schemas.
- **Codebase: `packages/contracts/src/draft.ts`** -- Reference pattern for a new contract module with WS methods, input schemas, and result schemas.
- **Codebase: `packages/contracts/src/notification.ts`** -- Reference pattern for a new contract module with push channels.
- **Codebase: `packages/contracts/src/baseSchemas.ts`** -- `makeEntityId`, `TrimmedNonEmptyString`, `IsoDateTime`, branded ID types.
- **Codebase: `apps/server/src/persistence/Migrations.ts`** -- Migration loader pattern, `Migrator.fromRecord` with static imports, current highest migration is 016.
- **Codebase: `apps/server/src/persistence/Migrations/016_ProjectionDrafts.ts`** -- Reference for CREATE TABLE migration pattern.
- **Codebase: `apps/server/src/persistence/Migrations/015_WorkspaceWorktreeEntries.ts`** -- Reference for ALTER TABLE migration pattern.
- **Codebase: `apps/server/src/persistence/Migrations/005_Projections.ts`** -- Schema of `projection_threads` and `projection_thread_sessions` tables, confirming `provider_thread_id` already exists on sessions table (not threads).
- **Codebase: `apps/server/src/persistence/Services/ProjectionDrafts.ts`** -- Reference for service interface pattern with `ServiceMap.Service`.
- **Codebase: `apps/server/src/persistence/Layers/ProjectionDrafts.ts`** -- Reference for layer implementation pattern with `SqlSchema` queries.
- **Codebase: `apps/server/src/persistence/Services/ProviderSessionRuntime.ts`** -- Reference for repository with `getByThreadId`, `upsert`, `list`, `deleteByThreadId`.
- **Codebase: `apps/server/src/persistence/Services/ProjectionThreads.ts`** -- Current `ProjectionThread` schema (no `providerThreadId` yet).
- **Codebase: `apps/server/src/persistence/Errors.ts`** -- Error types: `PersistenceSqlError`, `PersistenceDecodeError`, `ProjectionRepositoryError` type alias, `toPersistenceSqlError`, `toPersistenceDecodeError` helpers.
- **Codebase: `apps/server/src/wsServer.ts`** -- Complete WS route handler with exhaustive switch, `routeRequest` function, `RouteRequestError`, `ServerRuntimeServices` type, `stripRequestTag` helper.
- **Codebase: `apps/server/src/serverLayers.ts`** -- Service layer composition graph showing how repositories are wired into the runtime.
- **Codebase: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`** -- How `thread.created` events are projected to `projection_threads` table (must be updated for `providerThreadId`).
- **Codebase: `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`** -- How thread rows are read from `projection_threads` and assembled into `OrchestrationThread` objects (must be updated for `providerThreadId`).
- **Planning: `.planning/REQUIREMENTS.md`** -- Full requirements including table schemas, WS methods, enums, and schema field specifications.
- **Planning: `.planning/ROADMAP.md`** -- Phase 1 success criteria and plan structure.
- **Planning: `.planning/research/ARCHITECTURE.md`** -- Component responsibilities, project structure, data flow, anti-patterns.

### Secondary (MEDIUM confidence)

None needed. All findings are from direct codebase analysis.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all patterns from existing codebase
- Architecture: HIGH -- direct codebase analysis, every pattern has existing analogs
- Pitfalls: HIGH -- derived from observing where existing migrations/repositories have had to handle the same issues

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable patterns, no external API dependencies)
