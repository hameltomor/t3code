# Architecture Research

**Domain:** Chat history import/migration for an event-sourced CQRS code-agent GUI
**Researched:** 2026-03-12
**Confidence:** HIGH (derived directly from codebase analysis of XBE Code source + implementation spec)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Browser (apps/web)                               │
│  ┌──────────────┐  ┌──────────────────────────────────────────────────┐ │
│  │ ImportDialog │  │ ThreadImportProvenanceCard + thread route         │ │
│  │ (scan/select │  │ (badge, validate-link action, continue action)    │ │
│  │  /preview/   │  └──────────────────────────────────────────────────┘ │
│  │  import)     │                                                        │
│  └──────┬───────┘                                                        │
│         │ WebSocket RPC                                                  │
└─────────┼───────────────────────────────────────────────────────────────┘
          │ historyImport.list / .preview / .execute / .validateLink
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Server (apps/server)                             │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │               wsServer.ts  (WS routing layer)                     │  │
│  └──────────────────────────┬────────────────────────────────────────┘  │
│                             │                                            │
│  ┌──────────────────────────▼────────────────────────────────────────┐  │
│  │            HistoryImportService  (orchestrator)                    │  │
│  │  listCatalog · preview · execute · validateThreadLink              │  │
│  └──┬───────────────────┬────────────────────────────────────────────┘  │
│     │                   │                                               │
│     ▼                   ▼                                               │
│  ┌──────────────┐  ┌────────────────────────────────────────────────┐  │
│  │ProviderHistory│ │  materializeImportedThread.ts                  │  │
│  │Scanner        │ │  (dispatch thread.create + message/activity    │  │
│  │(scan/preview/ │ │   commands into OrchestrationEngine)           │  │
│  │ validateEntry)│ └────────────────────┬───────────────────────────┘  │
│  └──┬───────────┘                       │                              │
│     │                                   ▼                              │
│     │  ┌──────────────────────────────────────────────────────────┐   │
│     │  │           OrchestrationEngine (existing)                  │   │
│     │  │  decider → eventStore.append → projectionPipeline.project │   │
│     │  └──────────────────────────────────────────────────────────┘   │
│     │                                                                  │
│     │  Provider-local read (read-only)                                 │
│     ├──► ClaudeHistoryScanner  (~/.claude/projects/**/*.jsonl)         │
│     ├──► CodexHistoryScanner   (~/.codex/state_*.sqlite + rollouts)    │
│     └──► GeminiHistoryScanner  (~/.gemini/projects.json + chat JSON)   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  XBE SQLite (apps/server — only mutable target)                │   │
│  │  ┌──────────────────────┐  ┌──────────────────────────────┐   │   │
│  │  │ history_import_catalog│  │ thread_external_links         │   │   │
│  │  │ (discovery catalog)  │  │ (resume/validation metadata)  │   │   │
│  │  └──────────────────────┘  └──────────────────────────────┘   │   │
│  │  ┌──────────────────────────────────────────────────────────┐  │   │
│  │  │  orchestration_events + projection_thread_messages        │  │   │
│  │  │  projection_thread_activities  (existing read model)      │  │   │
│  │  └──────────────────────────────────────────────────────────┘  │   │
│  └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| `ImportConversationsDialog` (web) | 5-step UX: provider/scope → select → preview → options → result | WS RPC, thread route |
| `ThreadImportProvenanceCard` (web) | Shows import origin, validation badge, continue/validate actions | WS RPC |
| `wsServer.ts` | Routes `historyImport.*` WS methods to `HistoryImportService` | `HistoryImportService` |
| `HistoryImportService` | Orchestrates scan, list, preview, execute, validate; enforces workspace scope rules | `ProviderHistoryScanner`, `materializeImportedThread`, repositories, `OrchestrationEngine` |
| `ProviderHistoryScanner` | Fanout to per-provider scanners; normalizes to `HistoryImportConversationSummary` | `ClaudeHistoryScanner`, `CodexHistoryScanner`, `GeminiHistoryScanner`, `HistoryImportCatalogRepository` |
| `ClaudeHistoryScanner` | Reads `~/.claude/projects/<cwd>/*.jsonl` incrementally; extracts session metadata | `parseClaudeSession.ts`, provider-local filesystem (read-only) |
| `CodexHistoryScanner` | Reads Codex SQLite state + rollout JSONL; extracts thread metadata | `parseCodexRollout.ts`, provider-local SQLite (read-only) |
| `GeminiHistoryScanner` | Reads `~/.gemini/projects.json` + chat JSON sessions; extracts metadata | `parseGeminiSession.ts`, provider-local filesystem (read-only) |
| `materializeImportedThread.ts` | Dispatches `thread.create` + `thread.message-sent` + `thread.activity.append` commands for the imported transcript | `OrchestrationEngine.dispatch` |
| `validateExternalLink.ts` | Checks source path existence, fingerprint freshness, provider IDs still valid | `ThreadExternalLinkRepository`, provider-local filesystem |
| `HistoryImportCatalogRepository` | CRUD for `history_import_catalog` table; cache of discovered conversations | XBE SQLite |
| `ThreadExternalLinkRepository` | CRUD for `thread_external_links` table; durable resume metadata for imported threads | XBE SQLite |
| `OrchestrationEngine` (existing) | Processes commands into immutable events, runs decider + projector pipeline atomically | `OrchestrationEventStore`, `ProjectionPipeline` |
| `ProjectionPipeline` (existing) | Projects events into SQLite read-model tables (messages, activities, threads) | All projection repositories |

---

## Recommended Project Structure

```
apps/server/src/
├── historyImport/                     # NEW domain
│   ├── Services/
│   │   ├── HistoryImportService.ts    # Service interface (orchestrator)
│   │   ├── ProviderHistoryScanner.ts  # Service interface (scan fanout)
│   │   ├── HistoryImportCatalogRepository.ts  # Service interface
│   │   └── ThreadExternalLinks.ts     # Service interface
│   ├── Layers/
│   │   ├── HistoryImportService.ts    # Effect Layer (implementation)
│   │   ├── ProviderHistoryScanner.ts  # Effect Layer
│   │   ├── HistoryImportCatalogRepository.ts  # Effect Layer (SQLite impl)
│   │   └── ThreadExternalLinks.ts     # Effect Layer (SQLite impl)
│   ├── providers/
│   │   ├── ClaudeHistoryScanner.ts    # Provider-specific scanner
│   │   ├── CodexHistoryScanner.ts
│   │   ├── GeminiHistoryScanner.ts
│   │   ├── claude/
│   │   │   └── parseClaudeSession.ts  # JSONL parser/mapper
│   │   ├── codex/
│   │   │   └── parseCodexRollout.ts   # SQLite + JSONL parser
│   │   └── gemini/
│   │       └── parseGeminiSession.ts  # JSON session parser
│   ├── materializeImportedThread.ts   # Transcript → orchestration commands
│   └── validateExternalLink.ts        # Link freshness checker
├── persistence/
│   └── Migrations/
│       ├── 017_HistoryImportCatalog.ts   # NEW
│       └── 018_ThreadExternalLinks.ts    # NEW
packages/contracts/src/
└── historyImport.ts                      # NEW: all import schemas
apps/web/src/
└── components/
    ├── ImportConversationsDialog.tsx      # NEW
    └── ThreadImportProvenanceCard.tsx     # NEW
```

### Structure Rationale

- **`historyImport/`**: Domain isolation. The import domain does not bleed into orchestration, provider, or persistence layers. It depends on them as inputs only.
- **`Services/` vs `Layers/`**: Follows existing XBE pattern exactly. `Services/` defines the TypeScript service interface (type-only, no Effect Layer). `Layers/` implements it via `Effect.Layer`. This preserves testability — tests depend on `Services/` tags, test doubles are Layer swaps.
- **`providers/` subdirectory**: Each provider scanner is independent. Failure in one does not propagate to others. The scan fanout in `ProviderHistoryScanner` collects per-provider errors and surfaces them inline.
- **`parseXxx.ts` helpers**: Parser/mapper functions are pure or near-pure. They are unit-testable with fixture files (sample JSONL, SQLite, JSON) without spinning up Effect layers.
- **Migrations numbered 017/018**: Follows existing numbered migration convention. The catalog table and external links table are separate migrations with separate indexes.

---

## Architectural Patterns

### Pattern 1: Catalog-before-Materialization Separation

**What:** The scan phase and the import phase are fully separated. Scanning writes to `history_import_catalog` (a staging area with normalized summaries). Import reads from the catalog and then dispatches into the orchestration engine. The two phases never happen in the same transaction.

**When to use:** Always for history import. Never collapse discovery into thread creation.

**Trade-offs:**
- Pro: Scan can be retried or refreshed without affecting imported threads.
- Pro: List/preview is cheap — reads catalog table, no parser re-execution.
- Pro: Imported thread is decoupled from whether the source file still exists.
- Con: Two tables to maintain instead of one.

**Example (service boundary):**
```typescript
// SCAN phase: ProviderHistoryScanner
const summaries = yield* scanner.scanWorkspace({ workspaceRoot, provider })
// writes to history_import_catalog, returns summaries

// IMPORT phase: HistoryImportService.execute
const thread = yield* materializeImportedThread({ catalogEntry, input })
// reads from catalog, dispatches orchestration commands, writes external link
```

### Pattern 2: Event-Sourced Ingestion via Existing Command Dispatch

**What:** Imported transcript messages and activities are not written directly to projection tables. Instead, they flow through the existing `OrchestrationEngine.dispatch` path — `thread.message-sent` events and `thread.activity-appended` events are produced by the decider and projected by the existing `ProjectionPipeline`. The imported thread becomes indistinguishable from a live thread at the event-store level.

**When to use:** Always. Writing directly to projection tables would bypass the decider invariants and break the event store's sequence integrity. The event store is the source of truth.

**Trade-offs:**
- Pro: Imported threads pass through the same code path as live turns. No parallel projection logic.
- Pro: Full event history is auditable (import actor tagged as "server" in `actorKind`).
- Con: Large imports (2,000+ messages) are slower than a direct bulk insert; batching is needed.
- Con: If the orchestration engine crashes mid-import, cleanup requires checking for partial event sets.

**Example:**
```typescript
// materializeImportedThread dispatches in sequence:
yield* engine.dispatch({ type: "thread.create", commandId, threadId, projectId, ... })
for (const msg of importedMessages) {
  yield* engine.dispatch({ type: "thread.message.assistant.delta", commandId, threadId, messageId, ... })
  yield* engine.dispatch({ type: "thread.message.assistant.complete", commandId, threadId, messageId, ... })
}
for (const activity of importedActivities) {
  yield* engine.dispatch({ type: "thread.activity.append", commandId, threadId, activity, ... })
}
```

### Pattern 3: External Link as a Separate Table (Not Runtime State)

**What:** The `thread_external_links` table stores provider-native resume metadata (conversation ID, session ID, anchor ID, source fingerprint) separately from `provider_session_runtime` (which is only for XBE-managed live sessions) and `projection_thread_sessions` (which is only for the read-model session projection). The external link is purely informational until the user explicitly requests native resume.

**When to use:** Every import with `linkMode != "snapshot-only"` should persist an external link row. The link is optional from the thread's perspective — it degrades gracefully when missing or stale.

**Trade-offs:**
- Pro: Provider-native state drift (source file deleted, session expired) never corrupts the imported XBE transcript.
- Pro: `provider_session_runtime` and `projection_thread_sessions` remain clean; no import-specific columns needed.
- Con: Native resume requires resolving the external link at session start time — an extra lookup.

### Pattern 4: Fingerprint-Based Deduplication and Stale Detection

**What:** Each discovered conversation gets a deterministic `fingerprint` based on provider, normalized source path, provider IDs, timestamps, and message count. The catalog stores this fingerprint. The external link stores `sourceFingerprint` at import time. On `validateLink`, the current fingerprint is recomputed and compared to the stored one to detect staleness.

**When to use:** Fingerprinting must happen at scan time and be stored — never recomputed lazily on read.

**Trade-offs:**
- Pro: Cheap staleness check — stat the file, compare message count, compare timestamps.
- Pro: Prevents duplicate imports of the same conversation.
- Con: Fingerprint schema must be versioned; changing fields invalidates existing entries.

### Pattern 5: Incremental JSONL Parsing

**What:** Claude JSONL files and Codex rollout files can be large. Scanners must parse them incrementally (stream line by line) rather than loading the entire file into memory. For the catalog scan, only metadata fields need to be extracted (first/last message timestamps, message count, model, IDs). Full transcript parsing happens only for preview and import.

**When to use:** All JSONL-backed scanners. Codex SQLite and Gemini JSON are smaller and can be read in one pass.

**Trade-offs:**
- Pro: Bounded memory regardless of conversation length.
- Pro: Scan is fast — stop parsing after extracting metadata.
- Con: Two-pass read (scan for metadata, then re-read for transcript preview/import).

---

## Data Flow

### Scan + List Flow

```
Browser: historyImport.list({ projectId, provider?, includeNestedWorkspaces, forceRefresh })
    |
    v
wsServer.ts → HistoryImportService.listCatalog(input)
    |
    ├─ forceRefresh=false → read history_import_catalog (cache hit)
    |
    └─ forceRefresh=true  → ProviderHistoryScanner.scanWorkspace(workspaceRoot)
           |
           ├─ ClaudeHistoryScanner.scan(workspaceRoot)
           │      reads ~/.claude/projects/<cwd>/*.jsonl incrementally
           │      returns [HistoryImportConversationSummary, ...]
           |
           ├─ CodexHistoryScanner.scan(workspaceRoot)
           │      reads ~/.codex/state_*.sqlite threads table
           │      reads referenced rollout JSONL for metadata
           │      returns [HistoryImportConversationSummary, ...]
           |
           └─ GeminiHistoryScanner.scan(workspaceRoot)
                  reads ~/.gemini/projects.json + chat session JSON files
                  returns [HistoryImportConversationSummary, ...]
           |
           v
           HistoryImportCatalogRepository.upsertMany(summaries)
           HistoryImportCatalogRepository.deleteMissingForScanScope(scope)
           |
           v
    HistoryImportCatalogRepository.listByWorkspace(input)
    |
    v
Browser: receives [HistoryImportConversationSummary, ...]
```

### Preview Flow

```
Browser: historyImport.preview({ catalogId, messageLimit })
    |
    v
HistoryImportService.preview(input)
    → HistoryImportCatalogRepository.getByCatalogId(catalogId)
    → ProviderHistoryScanner.previewConversation({ catalogEntry, messageLimit })
          → provider-specific scanner re-reads source file for full transcript
          → maps to OrchestrationMessageLikePreview[]
          → maps to OrchestrationThreadActivityLikePreview[]
    |
    v
Browser: receives HistoryImportConversationPreview (summary + transcript sample)
```

### Import (Execute) Flow

```
Browser: historyImport.execute({ input: HistoryImportExecuteInput })
    |
    v
HistoryImportService.execute(input)
    │
    ├─ 1. HistoryImportCatalogRepository.getByCatalogId(catalogId) → catalogEntry
    │
    ├─ 2. ProviderHistoryScanner.previewConversation (full transcript, no message cap)
    │      → ImportedTranscript { messages, activities }
    │
    ├─ 3. materializeImportedThread(catalogEntry, importedTranscript, input)
    │      │
    │      ├─ OrchestrationEngine.dispatch(thread.create command)
    │      │   → event: thread.created → ProjectionPipeline projects to read model
    │      │
    │      ├─ for each message in transcript:
    │      │   OrchestrationEngine.dispatch(thread.message.assistant.delta)
    │      │   OrchestrationEngine.dispatch(thread.message.assistant.complete)
    │      │   → events: thread.message-sent (streaming=true then false)
    │      │   → ProjectionPipeline: projection_thread_messages upsert
    │      │
    │      └─ for each activity in transcript:
    │          OrchestrationEngine.dispatch(thread.activity.append)
    │          → event: thread.activity-appended
    │          → ProjectionPipeline: projection_thread_activities upsert
    │
    ├─ 4. (if linkMode != "snapshot-only")
    │      ThreadExternalLinkRepository.upsert(threadExternalLink)
    │      writes to thread_external_links table
    │
    └─ 5. return HistoryImportExecuteResult { threadId, importedMessageCount, ... }
    |
    v
Browser: navigates to new XBE thread, shows toast with import counts
```

### Link Validation Flow

```
Browser: historyImport.validateLink({ threadId })
    |
    v
HistoryImportService.validateThreadLink(input)
    → ThreadExternalLinkRepository.getByThreadId(threadId)
    → validateExternalLink(externalLink)
          → check: source path still exists (fs.stat)
          → check: recompute fingerprint fields, compare to sourceFingerprint
          → check: provider-specific IDs still present in source
          → returns: ValidationResult { status: "valid" | "stale" | "missing" | "invalid" }
    → ThreadExternalLinkRepository.markValidation({ threadId, status, validatedAt })
    |
    v
Browser: receives ThreadExternalLink with updated validationStatus
```

### Key Data Flow Principles

1. **Provider-local stores flow inward only.** Scanners read provider files; they never write. No XBE code mutates `~/.claude/`, `~/.codex/`, or `~/.gemini/`.
2. **XBE SQLite is the single mutable target.** The catalog table, external link table, and the existing event store + projection tables are all in the same SQLite database.
3. **Orchestration commands are the only ingestion path.** Transcripts enter XBE through `OrchestrationEngine.dispatch`, not through direct SQLite writes to projection tables.
4. **Push after scan, not during.** The `historyImport.catalogUpdated` push channel fires once after scan completion, not per-item. This avoids UI jitter on large scans.

---

## Anti-Patterns

### Anti-Pattern 1: Direct Projection Table Writes for Import

**What people do:** Write imported messages directly into `projection_thread_messages` to avoid the overhead of running through the orchestration engine.

**Why it's wrong:** Bypasses decider invariants, leaves the event store with no record of imported messages, makes the thread's event history incomplete, and diverges from the existing projection logic — causing subtle bugs when projectors are updated.

**Do this instead:** Always dispatch through `OrchestrationEngine.dispatch`. Batch the dispatches and accept the performance overhead. The import path is not latency-sensitive; correctness is.

### Anti-Pattern 2: Storing Import State in `provider_session_runtime`

**What people do:** Add an `importedFrom` column to `provider_session_runtime` or reuse it for imported conversation metadata.

**Why it's wrong:** `provider_session_runtime` is for *recoverable live session state* — it is deleted on session end, cleaned up on server restart, and its lifecycle is tied to the provider subprocess. Import metadata must survive session restarts and provider state deletion.

**Do this instead:** Use the dedicated `thread_external_links` table. It has a separate lifecycle, separate indexes, and separate validation semantics.

### Anti-Pattern 3: Scanning on Every List Request

**What people do:** Trigger a full filesystem scan on every `historyImport.list` call to ensure freshness.

**Why it's wrong:** JSONL files can be large. Scanning all providers on every list is slow, IO-bound, and may conflict with provider processes still writing to those files.

**Do this instead:** Read from the catalog table by default. Only rescan when `forceRefresh=true` is explicitly requested by the user (the "Refresh" button). The catalog table is the cache; the scan is the cache fill.

### Anti-Pattern 4: One Scanner Failure Fails the Whole List

**What people do:** Fan out to all provider scanners inside a single `Effect.all` that fails if any provider fails.

**Why it's wrong:** If Gemini config is malformed or Codex SQLite is locked, the user loses access to Claude imports too.

**Do this instead:** Use `Effect.allSettled` or collect per-provider `Either` results. Surface provider errors inline in the modal alongside successful results from other providers.

### Anti-Pattern 5: Preview Schema Reuse from `OrchestrationMessage`

**What people do:** Reuse `OrchestrationMessage` for preview payloads because the shape looks similar.

**Why it's wrong:** `OrchestrationMessage` requires `messageId: MessageId`, `turnId`, `streaming`, and other fields that don't exist yet — the thread hasn't been created. Forcing these fields means generating fake IDs that have no corresponding event store entries, which confuses the web client.

**Do this instead:** Define a separate `OrchestrationMessageLikePreview` schema for preview payloads. The schema is similar but does not carry XBE-assigned IDs.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `historyImport/*` → `OrchestrationEngine` | `dispatch(command)` | Import uses the same command dispatch path as live turns. Actor kind inferred as "server" from command ID prefix. |
| `historyImport/*` → `ProjectionPipeline` | None (indirect via OrchestrationEngine) | Import does not call projection repositories directly. |
| `historyImport/*` → `provider_session_runtime` | None | Import must not touch the runtime table. External link state lives in `thread_external_links`. |
| `historyImport/*` → existing `projection_thread_sessions` | None | Thread sessions remain null post-import until user starts a session. |
| `HistoryImportService` → `HistoryImportCatalogRepository` | Effect service call | Catalog reads/writes stay within the domain. |
| `HistoryImportService` → `ThreadExternalLinkRepository` | Effect service call | Link persistence stays within the domain. |
| `wsServer.ts` → `HistoryImportService` | Effect service call | New method routes added alongside existing orchestration routes. |
| Web store → WS client | `nativeApi.ts` extension | New `historyImport.*` methods registered in the native API layer. |

### External Boundaries (Read-Only)

| Source | Format | Scanner |
|--------|--------|---------|
| `~/.claude/projects/<cwd>/*.jsonl` | JSONL, one JSON object per line | `ClaudeHistoryScanner` + `parseClaudeSession.ts` |
| `~/.codex/state_*.sqlite` (threads table) | SQLite3 | `CodexHistoryScanner` + `parseCodexRollout.ts` |
| Codex rollout files (path from SQLite) | JSON/JSONL | `CodexHistoryScanner` |
| `~/.gemini/projects.json` + `tmp/<project>/chats/*.json` | JSON | `GeminiHistoryScanner` + `parseGeminiSession.ts` |

All external stores are read-only inputs. The implementation must not open them with write access.

---

## Build Order (Dependency Sequence)

Dependencies between components dictate this construction order:

```
1. contracts (packages/contracts/src/historyImport.ts)
   └─ no dependencies; defines all import schemas

2. DB migrations (017, 018)
   └─ depends on: contracts (for column names/types)

3. Repository Services + Layers
   ├─ HistoryImportCatalogRepository (Services + Layers)
   └─ ThreadExternalLinkRepository (Services + Layers)
   └─ depend on: contracts, migrations

4. Parser helpers (pure functions)
   ├─ parseClaudeSession.ts
   ├─ parseCodexRollout.ts
   └─ parseGeminiSession.ts
   └─ depend on: contracts (for normalized summary shapes)

5. Provider scanners
   ├─ ClaudeHistoryScanner
   ├─ CodexHistoryScanner
   └─ GeminiHistoryScanner
   └─ depend on: parser helpers, contracts

6. ProviderHistoryScanner (fanout coordinator)
   └─ depends on: provider scanners, HistoryImportCatalogRepository

7. materializeImportedThread.ts + validateExternalLink.ts
   └─ depends on: contracts, OrchestrationEngine (existing), ThreadExternalLinkRepository

8. HistoryImportService (orchestrator)
   └─ depends on: ProviderHistoryScanner, materializeImportedThread, validateExternalLink,
                  HistoryImportCatalogRepository, ThreadExternalLinkRepository

9. wsServer.ts route additions
   └─ depends on: HistoryImportService, contracts (WS method constants)

10. Web: ImportConversationsDialog + ThreadImportProvenanceCard
    └─ depends on: contracts (preview/summary schemas), wsServer routes live
```

**Phase 1 delivers steps 1-9 + basic modal UI.**
**Phase 2 adds:** link validation UX, provenance card, native continue actions (Claude/Codex), transcript-continue action (Gemini).
**Phase 3 adds:** background refresh, deduplication analytics, worktree-aware matching.

---

## Scaling Considerations

| Concern | Single-user local app | Notes |
|---------|-----------------------|-------|
| JSONL parse performance | Incremental line-by-line streaming | Cap preview at N messages; import batches commands |
| Catalog table size | Indexed by provider+workspace+updated_at | Prune rows for stale entries after each scan |
| Import command throughput | Batch message dispatches; accept ~100ms/message | Import is not interactive; 2,000 message cap with confirmation |
| SQLite write contention | Single-writer SQLite is fine for local use | OrchestrationEngine already serializes writes via command queue |
| Provider file locking | Read-only opens; no advisory locks needed | Codex may write SQLite concurrently — use WAL mode or retry on SQLITE_BUSY |

---

## Sources

- XBE Code source: `/home/danil.morozov/Workspace/t3code/apps/server/src/orchestration/` (OrchestrationEngine, decider, projector, ProjectionPipeline)
- XBE Code source: `/home/danil.morozov/Workspace/t3code/apps/server/src/persistence/` (all projection repositories, OrchestrationEventStore, ProviderSessionRuntime)
- XBE Code source: `/home/danil.morozov/Workspace/t3code/packages/contracts/src/orchestration.ts` (command/event schemas, OrchestrationReadModel)
- Implementation spec: `/home/danil.morozov/Workspace/t3code/tmp/history-import-implementation-spec.md`
- Effect-TS Layer pattern: observed from `Layers/` vs `Services/` split throughout existing codebase
- Confidence: HIGH — all patterns derived directly from the live codebase, not from external sources

---
*Architecture research for: Chat history import — XBE Code*
*Researched: 2026-03-12*
