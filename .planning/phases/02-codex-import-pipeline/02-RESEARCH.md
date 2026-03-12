# Phase 2: Codex Import Pipeline - Research

**Researched:** 2026-03-12
**Domain:** Codex CLI JSONL rollout parsing, SQLite metadata scanning, import materialization through OrchestrationEngine
**Confidence:** HIGH

## Summary

Phase 2 implements the Codex history scanner, JSONL parser, import materialization service, and WS method handlers. Phase 1 has landed all prerequisite schema, migrations, and repository layers (verified 10/10). The codebase is ready for the import pipeline.

The critical research blocker from Phase 1 -- validating `state_5.sqlite` schema columns and compaction event type names -- is now resolved. Direct inspection of the Codex open-source repo (`github.com/openai/codex`, `codex-rs/state/` and `codex-rs/protocol/`) confirms: (1) the database file is `state_5.sqlite` (STATE_DB_FILENAME = "state", STATE_DB_VERSION = 5); (2) the threads table has 19 columns including `id`, `rollout_path`, `cwd`, `title`, `source`, `model_provider`, `created_at`, `updated_at`, `tokens_used`, `agent_nickname`, `agent_role`; (3) timestamps are stored as epoch seconds (not ISO strings); (4) the JSONL format uses tagged-union `RolloutItem` with variants `SessionMeta`, `ResponseItem`, `Compacted`, `TurnContext`, `EventMsg`; (5) context compaction uses `RolloutItem::Compacted` with a `CompactedItem` payload containing `message: String` and `replacement_history: Option<Vec<ResponseItem>>`; (6) subagent sessions are identified by `source: SubAgent(...)` in the `SessionMeta`.

**Primary recommendation:** Implement a streaming JSONL parser that maps Codex `RolloutItem` types to XBE orchestration commands (`thread.create`, `thread.message-sent`, `thread.activity-appended`), with explicit handling for `Compacted` items (reset accumulated messages, use `replacement_history`), `encrypted_content` fields (skip), and subagent `SessionSource` variants (exclude). Use the existing `NodeSqliteClient` with `readonly: true` for `state_5.sqlite` metadata queries. Use `tinyglobby` for rollout file discovery under `~/.codex/sessions/YYYY/MM/DD/`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| effect | `pkg.pr.new/Effect-TS/effect-smol/effect@8881a9b` (v4 pre-release) | FileSystem streaming, Stream.splitLines, Schema validation, Service/Layer architecture | Already pinned in monorepo; all server code uses this |
| node:sqlite (DatabaseSync) | Node.js 24 built-in | Read-only access to Codex `state_5.sqlite` | Already wrapped by `NodeSqliteClient.ts` in the codebase |
| node:crypto | Node.js built-in | SHA-256 fingerprinting of rollout files | Already used in `telemetry/Identify.ts` |
| tinyglobby | ^0.2.15 | Glob-based discovery of `~/.codex/sessions/**/*.jsonl` | Already in lockfile (transitive); recommended by prior stack research |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @xbetools/contracts | workspace | `HistoryImport*` schemas, `OrchestrationCommand` types | All type definitions for WS methods and orchestration dispatch |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tinyglobby | Manual `FileSystem.readDirectory` recursion | tinyglobby handles YYYY/MM/DD nesting with one glob call; manual recursion is 30+ lines for same result |
| NodeSqliteClient (node:sqlite) | better-sqlite3 | node:sqlite is built-in, already used; no native addon compilation |
| Stream.splitLines + JSON.parse | effect/unstable/encoding/Ndjson | Ndjson is Channel-based, more plumbing; splitLines is simpler for file-based JSONL |

**Installation:**
```bash
cd apps/server && bun add tinyglobby
```

## Architecture Patterns

### Recommended Project Structure
```
apps/server/src/
  historyImport/
    Layers/
      CodexHistoryScanner.ts       # Scans ~/.codex/ for sessions, populates catalog
      CodexRolloutParser.ts        # Streams and parses individual JSONL rollout files
      HistoryImportService.ts      # Orchestrator: list/preview/execute methods
      HistoryMaterializer.ts       # Dispatches orchestration commands for import
    Services/
      CodexHistoryScanner.ts       # Service interface
      HistoryImportService.ts      # Service interface
      HistoryMaterializer.ts       # Service interface
    Schemas/
      CodexRolloutSchemas.ts       # Effect schemas for Codex JSONL line types
    Errors.ts                      # Tagged error types for import domain
```

### Pattern 1: Services/Layers Split (existing codebase pattern)
**What:** Each domain concept has a `Services/Foo.ts` (interface + ServiceMap.Service class) and `Layers/Foo.ts` (Effect.gen implementation + Layer.effect export).
**When to use:** Always -- this is the mandatory pattern in this codebase.
**Example:**
```typescript
// Services/HistoryImportService.ts
import { ServiceMap } from "effect"
import type { Effect } from "effect"

export interface HistoryImportServiceShape {
  readonly list: (input: HistoryImportListInput) =>
    Effect.Effect<ReadonlyArray<HistoryImportConversationSummary>, HistoryImportError>
  readonly preview: (input: HistoryImportPreviewInput) =>
    Effect.Effect<HistoryImportConversationPreview, HistoryImportError>
  readonly execute: (input: HistoryImportExecuteInput) =>
    Effect.Effect<HistoryImportExecuteResult, HistoryImportError>
}

export class HistoryImportService extends ServiceMap.Service<
  HistoryImportService,
  HistoryImportServiceShape
>()("xbe/historyImport/Services/HistoryImportService") {}
```

### Pattern 2: Streaming JSONL Parser (from stack research)
**What:** Line-by-line streaming of JSONL using Effect FileSystem with schema-tolerant parsing.
**When to use:** For all Codex rollout file reading.
**Example:**
```typescript
// Source: existing stack research STACK.md + Codex protocol analysis
import { FileSystem } from "effect"

const streamCodexRollout = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return fs.stream(filePath, { chunkSize: FileSystem.KiB(64) }).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter((line) => line.trim().length > 0),
      Stream.map((line) => {
        try {
          return Either.right(JSON.parse(line) as CodexRolloutLine)
        } catch (e) {
          return Either.left(new RolloutParseError({ line, cause: e }))
        }
      }),
      Stream.filterMap(Either.getRight), // skip malformed lines
    )
  }).pipe(Stream.unwrap)
```

### Pattern 3: Orchestration Command Dispatch for Import
**What:** Import materializes threads by dispatching commands through the existing OrchestrationEngine queue.
**When to use:** Always -- never write directly to projection tables.
**Example:**
```typescript
// Source: OrchestrationEngine.ts dispatch pattern
const importThread = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService
  const threadId = ThreadId.make()
  const now = new Date().toISOString()

  // 1. Create thread
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.makeUnsafe(`import:${crypto.randomUUID()}`),
    threadId,
    projectId,
    title,
    model,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    providerThreadId: codexSessionId, // enables dedup + future resume
    createdAt: now,
  })

  // 2. Dispatch messages
  for (const msg of messages) {
    yield* engine.dispatch({
      type: "thread.message-sent" === msg.role
        ? "thread.turn.start" // user messages need full command
        : "thread.message.assistant.complete", // assistant messages
      // ... command fields
    })
  }
})
```

### Pattern 4: Read-Only SQLite for External DB
**What:** Open Codex's `state_5.sqlite` read-only with WAL safety pragmas.
**When to use:** For metadata queries (thread listing by cwd).
**Example:**
```typescript
// Source: NodeSqliteClient.ts readonly support
import { NodeSqliteClient } from "../../persistence/NodeSqliteClient.ts"
import * as SqlClient from "effect/unstable/sql/SqlClient"

// Open as scoped read-only connection
const codexDbLayer = NodeSqliteClient.layer({
  filename: codexStatePath,
  readonly: true,
})

// After acquiring client, set busy_timeout
const withBusyTimeout = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`PRAGMA busy_timeout = 5000`
  return sql
})
```

### Anti-Patterns to Avoid
- **Direct projection writes:** Never INSERT into `projection_threads`, `projection_thread_messages`, etc. Always go through `OrchestrationEngine.dispatch`. The engine manages the in-memory read model, event store, and projection pipeline atomically.
- **Full-file loading:** Never `fs.readFile` on JSONL files. Always stream with `FileSystem.stream` + `Stream.splitLines`.
- **Write access to Codex DB:** Never open `state_5.sqlite` without `readonly: true`. Even accidental `PRAGMA journal_mode` would corrupt Codex's WAL chain.
- **Blocking the orchestration queue:** Dispatching 500 commands synchronously blocks all other orchestration activity. Use sequential dispatch with yielding, not parallel batch.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONL streaming | Custom buffer/split logic | `FileSystem.stream` + `Stream.splitLines` | Handles UTF-8 boundary splits, backpressure, cleanup |
| Glob scanning | Manual YYYY/MM/DD recursion | `tinyglobby` glob("sessions/**/*.jsonl") | One call vs 30+ lines of recursion |
| SHA-256 fingerprint | Custom hash wrapper | `crypto.createHash("sha256")` | Built-in, zero deps |
| SQLite read access | Raw node:sqlite calls | `NodeSqliteClient.layer({ readonly: true })` | Already has Statement caching, error mapping, scope cleanup |
| Command ID generation | Sequential counters | `CommandId.makeUnsafe(\`import:${crypto.randomUUID()}\`)` | Matches existing pattern, guaranteed unique |
| Schema-tolerant parsing | Manual try/catch | `Schema.decodeUnknownEither` | Tolerates unknown fields, provides structured errors |
| Service dependency injection | Manual constructor injection | Effect ServiceMap.Service + Layer.effect | Codebase-wide pattern, enables test isolation |

**Key insight:** The codebase already has all the infrastructure pieces. Phase 2 is about composing existing capabilities (Effect streaming, SQLite, OrchestrationEngine, repositories from Phase 1) into a new domain module, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Context Compaction Corrupts Message History
**What goes wrong:** A naive sequential scan imports both original messages AND the compaction summary, doubling the transcript.
**Why it happens:** Codex compacts conversations by emitting a `RolloutItem::Compacted` event that replaces all preceding content. The `CompactedItem` has `message: String` (summary text) and `replacement_history: Option<Vec<ResponseItem>>` (condensed items).
**How to avoid:** When parsing a rollout, track accumulated messages. When a `Compacted` item is encountered: (1) discard ALL previously accumulated messages and activities; (2) if `replacement_history` is `Some`, use those `ResponseItem` entries as the new message base; (3) if `replacement_history` is `None`, create a single system/assistant message from `CompactedItem.message`. Resume normal accumulation after the compaction event.
**Warning signs:** Imported threads have duplicate messages or message counts much larger than the original Codex session.

### Pitfall 2: Codex Timestamps Are Epoch Seconds, Not ISO Strings
**What goes wrong:** Treating `created_at`/`updated_at` from `state_5.sqlite` as ISO date strings causes parse failures or incorrect dates.
**Why it happens:** The Codex SQLite schema stores timestamps as `INTEGER` (Unix epoch seconds), not `TEXT` (ISO 8601). See `datetime_to_epoch_seconds` and `epoch_seconds_to_datetime` in `codex-rs/state/src/model/thread_metadata.rs`.
**How to avoid:** When querying Codex SQLite, convert epoch seconds to ISO strings: `new Date(epochSeconds * 1000).toISOString()`. The XBE catalog stores dates as ISO strings.
**Warning signs:** Dates appear as numbers in the UI or as "Invalid Date".

### Pitfall 3: SubAgent Sessions Flood the Import List
**What goes wrong:** The thread list shows hundreds of short-lived subagent sessions (review, compact, thread_spawn, memory_consolidation) alongside real user conversations.
**Why it happens:** Codex stores subagent sessions in the same `sessions/` directory and `threads` table. The `source` column contains serialized `SessionSource` enum values like `{"sub_agent":{"thread_spawn":{"parent_thread_id":"...","depth":1}}}`.
**How to avoid:** Filter by `source` column in SQLite query. Include only `source = 'cli'` or `source = 'vscode'` (the two interactive sources defined in `INTERACTIVE_SESSION_SOURCES`). Exclude `exec`, `mcp`, and all `sub_agent` variants. Also exclude sessions where `agent_nickname IS NOT NULL` (subagent indicator).
**Warning signs:** Import list shows sessions with very short durations, zero user messages, or cryptic auto-generated titles.

### Pitfall 4: Encrypted Reasoning Fields Must Be Skipped
**What goes wrong:** Attempting to import `encrypted_content` from `ResponseItem::Reasoning` causes garbled text in imported messages.
**Why it happens:** Codex stores reasoning content with optional `encrypted_content: Option<String>` field. This is base64-encoded encrypted data that cannot be decoded without the session's encryption key.
**How to avoid:** When processing `ResponseItem::Reasoning`, check for `encrypted_content`. If present, skip the entire reasoning item (do not import it as a message). Only use the `summary` field from reasoning items.
**Warning signs:** Imported messages contain long base64-like strings.

### Pitfall 5: Rollout File May Be Actively Written
**What goes wrong:** Reading a rollout file while Codex is actively writing to it produces a truncated last line that fails JSON.parse.
**Why it happens:** JSONL appends are not atomic at the OS level; a concurrent reader can see a partial final line.
**How to avoid:** When parsing the last line of a JSONL file, catch `JSON.parse` errors and silently skip the malformed line. Never abort the entire import because of a single bad line. Use `Stream.either` + `Stream.filterMap(Either.getRight)` pattern.
**Warning signs:** Import fails with "Unexpected end of JSON input" on the last line.

### Pitfall 6: Duplicate Import Creates Ghost Threads
**What goes wrong:** User clicks import twice, gets two identical threads.
**Why it happens:** No deduplication check before `thread.create`.
**How to avoid:** Before dispatching `thread.create`, check if a thread with the same `providerThreadId` already exists in the read model (via `OrchestrationEngine.getReadModel()`). The `projection_threads` table has a unique partial index on `provider_thread_id` (migration 019). If found, return the existing thread ID with an "already imported" indicator.
**Warning signs:** Thread list shows duplicate entries with identical titles and message counts.

### Pitfall 7: Import Must Use message-sent Not turn.start for Imported Messages
**What goes wrong:** Using `thread.turn.start` for imported user messages triggers provider session startup, approval flows, and other turn lifecycle side effects.
**Why it happens:** `thread.turn.start` is designed for live conversations -- it signals the orchestration reactor to start a provider session and begin a turn.
**How to avoid:** For import materialization, use only these command types: (1) `thread.create` once; (2) `thread.message-sent` for each user AND assistant message (the `ThreadMessageSentPayload` accepts any `OrchestrationMessageRole`); (3) `thread.activity-appended` for tool calls and approvals. The decider in `decider.ts` handles `thread.message-sent` by simply recording the event without triggering provider lifecycle. NOTE: The existing `OrchestrationCommand` union does NOT include a standalone `thread.message-sent` command -- it only exists as an event type. The import materializer will need to find the correct internal command type that produces `thread.message-sent` events, or dispatch events directly. This is an **open design question** -- see Open Questions section.
**Warning signs:** Importing a thread triggers Codex process startup.

### Pitfall 8: Streaming/Incomplete Messages from Interrupted Sessions
**What goes wrong:** A session killed mid-stream leaves the last assistant message with `streaming: true` forever, blocking "Continue" in the UI.
**Why it happens:** The Codex agent was interrupted before emitting a `TurnComplete` event. The rollout file ends with deltas but no completion marker.
**How to avoid:** After processing all rollout lines, scan accumulated messages. Any message still marked `streaming: true` should be force-completed (set `streaming: false`). This is a post-processing step after the full file is streamed.
**Warning signs:** Imported threads show a permanently-spinning "streaming" indicator on the last message.

## Code Examples

### Codex JSONL RolloutLine Format (Verified from openai/codex source)
```typescript
// Source: codex-rs/protocol/src/protocol.rs - RolloutLine, RolloutItem
// Each line in a .jsonl file is:
// {"timestamp": "2026-03-12T10:00:00.000Z", "type": "session_meta"|"response_item"|"compacted"|"turn_context"|"event_msg", "payload": {...}}

// RolloutItem variants (tagged union, tag = "type", content = "payload"):
interface CodexRolloutLine {
  timestamp: string
  type: "session_meta" | "response_item" | "compacted" | "turn_context" | "event_msg"
  payload: unknown
}

// SessionMeta payload:
interface SessionMetaPayload {
  meta: {
    id: string           // UUID thread ID
    forked_from_id?: string
    timestamp: string
    cwd: string
    originator: string   // "codex_cli_rs"
    cli_version: string
    source: string | { sub_agent: { thread_spawn: { parent_thread_id: string, depth: number } } }
    agent_nickname?: string
    agent_role?: string
    model_provider?: string
    base_instructions?: string
    dynamic_tools?: unknown[]
    memory_mode?: string
  }
  git?: {
    commit_hash?: string
    branch?: string
    repository_url?: string
  }
}

// ResponseItem payload (message from assistant):
interface ResponseItemPayload {
  type: "message" | "reasoning" | "local_shell_call" | "function_call" | "function_call_output" | ...
  // For "message":
  role?: string          // "user" | "assistant"
  content?: Array<{ type: "input_text" | "output_text", text: string }>
  // For "reasoning":
  summary?: Array<{ type: string, text: string }>
  encrypted_content?: string  // SKIP THIS
}

// CompactedItem payload:
interface CompactedPayload {
  message: string
  replacement_history?: ResponseItemPayload[]  // condensed items after compaction
}

// TurnContext payload:
interface TurnContextPayload {
  turn_id?: string
  cwd: string
  model: string
  approval_policy: string   // "never" | "on-request" | "on-failure" | "untrusted"
  sandbox_policy: unknown
}

// EventMsg payload (tagged union, tag = "type"):
// Key variants for import:
// - "user_message": { message: string, images?: string[] }
// - "agent_message": { message: string }
// - "task_started" (alias: turn_started): { turn_id: string }
// - "task_complete" (alias: turn_complete): { turn_id: string, last_agent_message?: string }
// - "context_compacted": {} (empty struct)
// - "token_count": { info?: { total_token_usage: { total_tokens: number } } }
// - "exec_command_begin": { command: string, cwd: string }
// - "exec_command_end": { exit_code: number }
// - "exec_approval_request": { command: string }
// - "apply_patch_approval_request": { ... }
// - "error": { message: string }
```

### Codex state_5.sqlite Threads Table Schema (Verified from openai/codex source)
```sql
-- Source: codex-rs/state/migrations/0001_threads.sql + subsequent ALTER TABLE migrations
-- Database file: ~/.codex/state_5.sqlite (STATE_DB_FILENAME = "state", STATE_DB_VERSION = 5)

CREATE TABLE threads (
  id              TEXT PRIMARY KEY,     -- UUID string
  rollout_path    TEXT NOT NULL,        -- absolute path to .jsonl file
  created_at      INTEGER NOT NULL,    -- epoch seconds (NOT ISO string!)
  updated_at      INTEGER NOT NULL,    -- epoch seconds
  source          TEXT NOT NULL,        -- "cli" | "vscode" | "exec" | "mcp" | JSON for sub_agent
  model_provider  TEXT NOT NULL,        -- e.g. "openai"
  cwd             TEXT NOT NULL,        -- working directory path
  title           TEXT NOT NULL DEFAULT '',
  sandbox_policy  TEXT NOT NULL,
  approval_mode   TEXT NOT NULL,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  has_user_event  INTEGER NOT NULL DEFAULT 0,  -- boolean 0/1
  archived        INTEGER NOT NULL DEFAULT 0,  -- boolean 0/1
  archived_at     INTEGER,             -- epoch seconds, nullable
  git_sha         TEXT,
  git_branch      TEXT,
  git_origin_url  TEXT,
  -- Added by migration 0005:
  cli_version     TEXT NOT NULL DEFAULT '',
  -- Added by migration 0007:
  first_user_message TEXT NOT NULL DEFAULT '',
  -- Added by migration 0013:
  agent_nickname  TEXT,
  agent_role      TEXT
);

-- Indexes
CREATE INDEX idx_threads_created ON threads(created_at DESC, id DESC);
CREATE INDEX idx_threads_updated ON threads(updated_at DESC, id DESC);
CREATE INDEX idx_threads_archived ON threads(archived);
CREATE INDEX idx_threads_source ON threads(source);
CREATE INDEX idx_threads_model_provider ON threads(model_provider);
```

### Rollout File Path Pattern (Verified from openai/codex source)
```
~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl

Example:
~/.codex/sessions/2026/03/12/rollout-2026-03-12T10-30-45-550e8400-e29b-41d4-a716-446655440000.jsonl
```

### Fingerprint Computation
```typescript
// Source: stack research STACK.md
import { createHash } from "node:crypto"

function computeFingerprint(sessionId: string, fileSize: number, mtimeMs: number, headBytes: Buffer, tailBytes: Buffer): string {
  const hash = createHash("sha256")
  hash.update(sessionId)
  hash.update(String(fileSize))
  hash.update(String(mtimeMs))
  hash.update(headBytes)
  if (tailBytes.length > 0) hash.update(tailBytes)
  return hash.digest("hex")
}
```

### Workspace Root Matching for Codex Sessions
```sql
-- Query Codex state_5.sqlite for sessions matching workspace root
-- Note: cwd may be an exact match OR a child directory
SELECT id, rollout_path, cwd, title, model_provider, created_at, updated_at,
       source, first_user_message, tokens_used, agent_nickname
FROM threads
WHERE (cwd = ? OR cwd LIKE ? || '/%')
  AND source IN ('cli', 'vscode')
  AND agent_nickname IS NULL
  AND archived = 0
ORDER BY updated_at DESC
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Codex `.json` rollout files | `.jsonl` rollout files | Codex v0.2+ (2025) | Must detect format by extension; `.json` files are single-object, `.jsonl` are line-delimited |
| No compaction events | `Compacted` RolloutItem with `replacement_history` | Codex v0.3+ (2025) | Must handle compaction during import |
| No subagent tracking | `SessionSource::SubAgent(...)` with variants | Codex v0.4+ (2025) | Must filter subagent sessions |
| Basic shell approval | Rich approval types (exec, patch, permissions, elicitation) | Codex v0.5+ (2025-2026) | Activity import should capture approval types |

**Deprecated/outdated:**
- `.json` rollout format: Still exists on disk for old sessions but Codex now creates `.jsonl` exclusively. Support both for completeness.
- `has_user_event` column: Still present but `first_user_message` (migration 0007) is preferred for title/preview extraction.

## Open Questions

1. **How to dispatch imported messages through OrchestrationEngine**
   - What we know: The decider handles `thread.create`, `thread.message-sent` (as an event type), and `thread.activity-appended` (as an event type). However, looking at the `OrchestrationCommand` union, the internal commands for emitting messages are: `thread.turn.start` (for user messages + turn lifecycle), `thread.message.assistant.delta` / `thread.message.assistant.complete` (for assistant messages). There is no standalone "add a message without starting a turn" command.
   - What's unclear: The exact command sequence to materialize imported messages without triggering turn/session lifecycle. Using `thread.turn.start` would trigger provider startup via `ProviderCommandReactor`. Using `thread.message.assistant.complete` requires an active turn context.
   - Recommendation: The import materializer may need to add a new internal command type (e.g., `thread.message.import`) that produces `thread.message-sent` events without triggering turn lifecycle. Alternatively, dispatch messages using the existing `thread.message-sent` event path by modifying the decider to accept a new `thread.message.send` command. **This is the most important design decision for Phase 2 planning.** The planner should review the decider and decide between: (a) adding a new command, (b) using existing commands with careful sequencing, or (c) dispatching events directly to the event store (bypassing the command queue but losing deduplication).

2. **Old `.json` format structure**
   - What we know: Codex previously used `.json` rollout files (single JSON object per file, not line-delimited). The open-source repo mentions both formats.
   - What's unclear: The exact structure of the old `.json` format (is it a single `RolloutLine` object, or a different schema entirely?).
   - Recommendation: Detect by file extension. For `.json` files, try `JSON.parse` of the full file (they are likely small since they predate the multi-turn rollout era). If the parse fails or the structure is unrecognized, skip with a warning. Do not block the scanner on `.json` support -- `.jsonl` is the priority.

3. **Codex home directory configuration**
   - What we know: The Codex home dir is configurable via `CODEX_SQLITE_HOME` env var and `sqlite_home` config key. The default is `~/.codex/`.
   - What's unclear: Whether XBE should respect Codex's config file for non-default home dirs.
   - Recommendation: Default to `~/.codex/`. Optionally read `CODEX_SQLITE_HOME` env var. Do not parse Codex's config file -- too fragile and version-dependent.

4. **Deduplication scope: providerThreadId vs provider+session compound key**
   - What we know: Phase 1 added `providerThreadId` to `projection_threads` with a partial unique index. The `thread_external_links` table has `provider_session_id` and `provider_conversation_id` as separate fields. The Codex thread `id` (UUID) is the natural deduplication key.
   - What's unclear: Whether `providerThreadId` should be set to the Codex `thread_id` UUID, or a compound key like `codex:<uuid>`.
   - Recommendation: Use `codex:<uuid>` format for `providerThreadId` to namespace across providers. This prevents collisions if two providers happen to use the same UUID scheme.

## Sources

### Primary (HIGH confidence)
- `openai/codex` GitHub repo (`codex-rs/state/migrations/0001_threads.sql` through `0013_threads_agent_nickname.sql`) -- threads table schema with all columns
- `openai/codex` (`codex-rs/state/src/model/thread_metadata.rs`) -- `ThreadMetadata` struct, `ThreadRow` with SQLite column mapping, epoch seconds timestamp handling
- `openai/codex` (`codex-rs/protocol/src/protocol.rs`) -- `RolloutItem` enum (SessionMeta, ResponseItem, Compacted, TurnContext, EventMsg), `CompactedItem` struct, `EventMsg` variants, `SessionSource` enum with SubAgent
- `openai/codex` (`codex-rs/state/src/extract.rs`) -- `apply_rollout_item()` function showing exactly how each RolloutItem type maps to thread metadata
- `openai/codex` (`codex-rs/state/src/lib.rs`) -- STATE_DB_FILENAME = "state", STATE_DB_VERSION = 5, confirming `state_5.sqlite`
- `openai/codex` (`codex-rs/core/src/rollout/mod.rs` and `list.rs`) -- SESSIONS_SUBDIR = "sessions", file naming pattern `rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl`, INTERACTIVE_SESSION_SOURCES = [Cli, VSCode]
- XBE codebase (`apps/server/src/orchestration/`) -- OrchestrationEngine dispatch, decider, projector, command/event types
- XBE codebase (`apps/server/src/persistence/`) -- NodeSqliteClient, migrations, repository patterns
- XBE codebase (`packages/contracts/src/`) -- historyImport.ts, orchestration.ts, ws.ts schemas

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` -- stack recommendations (verified against installed source)
- `.planning/research/SUMMARY.md` -- architecture recommendations (verified against codebase)

### Tertiary (LOW confidence)
- None -- all critical claims verified from primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in codebase or lockfile; patterns verified from source
- Architecture: HIGH -- follows existing Services/Layers split; all target APIs inspected
- Codex format: HIGH -- all type definitions, column names, and event structures verified from openai/codex source code
- Pitfalls: HIGH -- 8 pitfalls grounded in verified source code analysis (compaction handling, epoch timestamps, subagent filtering, encrypted content)

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (Codex format may evolve; re-check if openai/codex has major releases)
