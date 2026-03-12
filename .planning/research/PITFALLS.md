# Common Pitfalls: File-Based Chat History Import for Developer Tools

**Domain:** Chat history import from file-based provider storage (Claude Code, Codex CLI, Gemini CLI) into an event-sourced developer tool GUI
**Researched:** 2026-03-12
**Confidence:** HIGH — derived from direct codebase analysis of XBE Code, official provider documentation, and cross-referenced against known problems in similar file-migration systems.

---

## Context

XBE Code imports conversation history from three providers:

- **Claude Code**: JSONL at `~/.claude/projects/<encoded-path>/<session-id>.jsonl` (files up to 70MB; path encoding replaces `/` with `-`; optional `sessions-index.json`)
- **Codex CLI**: JSONL rollouts at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `state_5.sqlite`; old `.json` and new `.jsonl` formats coexist; encrypted reasoning fields; context compaction events
- **Gemini CLI**: JSON at `~/.gemini/tmp/<project-slug>/chats/session-*.json`; hash-to-slug migration; project registry

All three providers write to user home directory paths. Files may be actively written during import. Imported threads pass through the XBE event-sourcing pipeline (`OrchestrationEngine.dispatch` → `ProjectionPipeline`) to become normal XBE threads stored in `orchestration_events` and projection tables.

---

## Pitfall 1: Loading Large JSONL Files Entirely Into Memory

**Severity: CRITICAL**

### Problem

Claude Code JSONL files can reach 70MB. A single long session produces a file with thousands of JSON objects, each containing full message payloads including code, tool output, and reasoning summaries. Loading the entire file into memory with `fs.readFileSync` or `await fs.readFile` before parsing will:

- Allocate 70MB+ per file in the Node.js heap per concurrent import.
- Trigger V8 garbage collection pauses during downstream processing.
- Cause OOM crashes on machines with limited RAM when multiple imports run concurrently (users who import multiple large sessions at once).
- Make scan operations that only need metadata (title, message count, timestamps) needlessly slow.

The XBE server is a single-user local process, not a cloud server with swap, so memory spikes are felt immediately and there is no safety net.

### Warning Signs

- `process.memoryUsage().heapUsed` spikes by 70MB+ during scan.
- Scan of a directory with 10 large sessions OOMs on a machine with 8GB RAM.
- Preview render time scales linearly with file size rather than with `messageLimit`.
- Node.js process is killed by the OS OOM killer during import.

### Prevention Strategy

Parse JSONL incrementally using `readline` or a line-by-line streaming approach. Never buffer more than one line at a time during scan.

```typescript
// WRONG: loads 70MB into memory
const content = await fs.readFile(path, "utf-8");
const lines = content.split("\n").map(JSON.parse);

// RIGHT: streaming line reader
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({ input: createReadStream(filePath, { encoding: "utf-8" }) });
for await (const line of rl) {
  if (!line.trim()) continue;
  const record = JSON.parse(line);
  // extract metadata fields, yield to caller when done
}
```

For scan (catalog population), stop reading after extracting: `sessionId`, `createdAt`, `updatedAt`, model, and message count. Do not read the full file for metadata-only passes.

For preview and import, stream line-by-line and cap preview at `messageLimit`. For import, dispatch messages in batches rather than accumulating all events in an array before dispatching.

The existing codebase already uses a 2,000-message cap (`MAX_THREAD_MESSAGES` in `projector.ts`) and a 500-checkpoint cap. These caps apply to the in-memory read model, but they do not protect against loading a 70MB file into memory during the parse step.

---

## Pitfall 2: Assuming a Stable Provider Format

**Severity: HIGH**

### Problem

All three provider CLIs ship independently and update their storage formats without coordination with XBE. Format changes that have already occurred:

- **Codex**: Migrated from `.json` rollout files to `.jsonl` rollout files. The old `state.sqlite` was renamed to `state_5.sqlite`. Both old and new files may exist simultaneously on a user's machine.
- **Claude Code**: Introduced `sessions-index.json` in a later version as a fast-scan optimization. Older installations lack this file entirely. The JSONL schema for individual messages has evolved (new fields added, some optional fields silently dropped).
- **Gemini CLI**: Underwent a hash-to-slug migration for project directory names. Sessions written before the migration live under hash-based directories; sessions written after live under slug-based directories. Both coexist on disk.

Treating any of these formats as immutable will cause silent data loss or hard failures when users upgrade their CLI tools.

### Warning Signs

- A parser function uses `JSON.parse(line)` and then accesses a field with a non-null assertion (`record.sessionId!`) — if the field was added in a later version, older files will silently return `undefined`.
- Tests only use fixture files captured from one CLI version.
- The scan returns 0 conversations for a user who has a large Codex history because they have only the old `.json` format.
- Gemini scanner finds no sessions because it only looks in slug-based directories.

### Prevention Strategy

Parse all provider formats defensively with explicit validation. Use `Schema.decodeUnknownOption` or equivalent from the Effect-TS schema library rather than casting unknown JSON directly to a typed shape. Treat missing fields as version-mismatch signals, not bugs.

For Codex specifically, detect format by inspecting the file extension:

```typescript
function resolveRolloutFormat(filePath: string): "json" | "jsonl" | "unknown" {
  if (filePath.endsWith(".jsonl")) return "jsonl";
  if (filePath.endsWith(".json")) return "json";
  return "unknown";
}
```

For Gemini, scan both hash-based and slug-based directories and merge results by session ID to avoid duplicates.

For Claude Code, fall back gracefully when `sessions-index.json` is absent: perform a direct JSONL scan instead of using the index. Never require the index to be present.

Version-stamp each discovered catalog entry with a `detectedFormatVersion` field in `history_import_catalog`. When the schema changes in a future XBE release, entries with a stale version can be re-scanned on next refresh rather than failing silently.

---

## Pitfall 3: Timestamp Ordering Bugs Across Providers

**Severity: HIGH**

### Problem

Each provider stores timestamps differently:

- **Claude Code**: ISO 8601 strings in each JSONL line (`timestamp` field).
- **Codex**: Unix epoch integers (seconds) in rollout files; the SQLite `state_5.sqlite` may store them as TEXT ISO strings.
- **Gemini**: ISO 8601 strings, but the timezone handling is inconsistent — some builds emit UTC, others emit local time without a timezone suffix.

Cross-provider bugs that emerge:

1. **Epoch vs. milliseconds confusion**: If a Codex timestamp is read as seconds but passed to `new Date()` which expects milliseconds, the resulting date is in 1970. This causes imported Codex threads to sort to the beginning of the thread list instead of their actual date.
2. **Timezone-naive strings**: A Gemini timestamp like `"2025-04-01T14:30:00"` (no `Z` suffix) is parsed as local time by `new Date()` in Node.js but as UTC by ISO 8601 spec. On a machine in UTC+5, this is 5 hours off, causing ordering artifacts against Claude Code threads.
3. **JSONL line ordering assumption**: Assuming that JSONL lines within a single file are already in chronological order. This is true for Claude Code (append-only) and Codex rollouts, but it is an assumption, not a contract. Context compaction events in Codex rollouts insert synthetic past-time events out of order (see Pitfall 9).

### Warning Signs

- Imported threads appear with timestamps from 1970 (classic epoch-as-seconds-interpreted-as-milliseconds bug).
- Thread list interleaves imported sessions from the same day with wildly different positions depending on provider.
- Tests pass in UTC but fail in CI running in a non-UTC timezone.

### Prevention Strategy

Normalize all provider timestamps to UTC ISO 8601 strings at parse time, inside each provider's parser module, before they reach `materializeImportedThread`. Never pass raw provider timestamps downstream.

```typescript
function normalizeTimestamp(raw: string | number | undefined, fallback: string): string {
  if (typeof raw === "number") {
    // Codex epoch: distinguish seconds from milliseconds by magnitude
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === "string") {
    // Force UTC interpretation for timezone-naive strings
    const withZ = raw.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`;
    const date = new Date(withZ);
    return isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  return fallback;
}
```

Do not rely on JSONL line order for chronological ordering within a session. Sort messages explicitly by normalized timestamp after parsing, then by original line index as a tiebreaker.

Run all timestamp-related tests with `TZ=America/Los_Angeles` set in the environment to catch timezone-naive bugs in CI.

---

## Pitfall 4: Duplicate Import and Re-Import Handling

**Severity: HIGH**

### Problem

Users will import the same conversation multiple times, either intentionally (to get updated messages after continuing a Codex session) or accidentally (clicking import twice, re-running after a failed import). Without deduplication:

- The thread list fills with multiple copies of the same conversation with different XBE thread IDs.
- Re-running a failed import after partial success creates a thread with duplicate messages.
- If the import UI does not surface "already imported" status, users cannot tell which threads are originals.

A secondary problem: the `fingerprint` field used for deduplication must be computed deterministically. If the fingerprint changes between XBE releases (e.g., because a new field was added to the computation), all previously-imported threads show as "unimported" again, prompting mass re-import.

### Warning Signs

- Thread list contains `[Codex: my-project 2025-04-01]` five times after the user clicked import from the history dialog multiple times.
- A `bun run test` test that imports the same fixture twice creates two distinct threads in the event store.
- After an XBE upgrade, all imported threads lose their "already imported" badge.

### Prevention Strategy

Store a `providerThreadId` on the `ThreadCreateCommand` and in the resulting `thread.created` event payload. Index this field in `projection_threads` for O(1) lookup.

Before executing an import, query the projection for any existing thread with the same `(providerKind, providerThreadId)` pair. Return the existing thread ID in the result rather than creating a duplicate.

```typescript
const existing = await projectProjectionThreadByProviderThreadId({
  providerKind: catalogEntry.providerKind,
  providerThreadId: catalogEntry.providerThreadId,
});
if (existing !== null) {
  return { threadId: existing.id, alreadyImported: true, importedMessageCount: 0 };
}
```

For fingerprint stability, version-stamp the fingerprint schema. If the fingerprint computation changes, increment the version prefix and treat old-versioned fingerprints as stale (re-scan on next refresh) rather than invalid (panic or re-import).

For re-import (user explicitly wants to update an existing imported thread with new messages from the provider), implement a separate `reimport` path that appends only net-new messages after the last imported message's timestamp. Never delete and recreate a thread for re-import — this destroys the event history.

---

## Pitfall 5: Partial Failure Recovery — Thread Created but Transcript Import Fails Mid-Way

**Severity: HIGH**

### Problem

The import execution path dispatches multiple commands in sequence: first `thread.create`, then N `thread.message.assistant.delta` + `thread.message.assistant.complete` commands, then M `thread.activity.append` commands. If the process crashes, the connection drops, or a single message fails to parse after the thread has been created, the result is an XBE thread in the thread list with zero messages — a ghost thread.

Because the `OrchestrationEngine` processes one command at a time through a serial queue, commands already dispatched before the failure are committed to the event store and cannot be rolled back without a compensating event.

For a JSONL with 2,000 messages, a failure at message 1,500 leaves 1,499 imported messages in the thread. The user sees a truncated conversation with no explanation.

### Warning Signs

- Thread list shows a thread titled "Claude: my-project" with 0 messages and a "No messages" empty state.
- A test that simulates a mid-import crash leaves the SQLite event store with a `thread.created` event but no `thread.message-sent` events.
- The import result says "1 thread imported" but navigating to the thread shows no content.

### Prevention Strategy

Track import progress in the `history_import_catalog` table with an `importStatus` column: `"pending"`, `"in-progress"`, `"complete"`, `"failed-partial"`. Set it to `"in-progress"` before dispatching the first command and update it to `"complete"` or `"failed-partial"` atomically with the external link write.

On failure, record the last successfully imported message position in the catalog row so a retry can resume from that offset rather than starting over. On the UI side, surface partial imports with a warning badge:

```
[!] Partially imported — 1,342 of 2,000 messages recovered. Re-import to complete.
```

For ghost thread prevention, always dispatch `thread.create` last if a zero-message thread is worse than no thread. Alternatively, wrap the full import in a logical transaction by creating a draft thread state before committing. But given the existing engine architecture (serial command queue with immediate SQLite commits), the most robust option is: mark the thread as `importStatus: "partial"` in the external link table and surface that status in the UI so users understand the thread is incomplete.

Do not silently delete partial threads on failure. Partial content is better than nothing for conversations users care about.

---

## Pitfall 6: Encrypted and Opaque Fields in Codex Rollouts

**Severity: MEDIUM**

### Problem

Codex rollout JSONL files contain an `encrypted_content` field on certain events (specifically, extended thinking / reasoning traces). These fields are AES-encrypted with a per-session key that is stored in the Codex SQLite database. XBE does not have access to the decryption key.

Attempting to deserialize, display, or process `encrypted_content` as text content will either:
1. Show garbled base64/ciphertext to the user as if it were model reasoning.
2. Cause a JSON parse error if the field is mistakenly treated as nested JSON.
3. Silently corrupt the imported message text by concatenating encrypted bytes into the `text` field.

A related problem: future Codex versions may introduce additional opaque or provider-internal fields (internal tool IDs, server-side references) that have no meaningful representation in XBE's schema.

### Warning Signs

- Imported Codex messages contain text like `"AgIDADE..."` or similar base64 strings.
- The `text` field of an imported message is unexpectedly long (several KB) for what was a short reasoning step.
- Tests using real Codex rollout fixtures fail to decode certain lines because `encrypted_content` is treated as required text content.

### Prevention Strategy

Explicitly skip `encrypted_content` fields in `parseCodexRollout.ts`. Do not attempt to decrypt, display, or summarize them. When an event contains only encrypted content and no plaintext, map it to a synthetic activity entry rather than a message:

```typescript
if (event.type === "reasoning" && event.encrypted_content) {
  // Do not import as message content.
  // Optionally create an activity entry: "Encrypted reasoning step (N bytes)"
  return { kind: "activity", summary: "Encrypted reasoning step", tone: "info" };
}
```

Apply the same principle to any unrecognized event type: skip-with-activity rather than error. The contract is: unrecognized fields are ignored; unrecognized event types produce a synthetic activity entry noting that N events were skipped.

Document the list of recognized Codex event types in a comment at the top of `parseCodexRollout.ts` so future maintainers know to update it when new event types appear in Codex changelogs.

---

## Pitfall 7: File Locking Conflicts with Active CLI Sessions

**Severity: HIGH**

### Problem

All three providers write to their storage files while the CLI is actively running a session. If a user imports while Codex is mid-session:

- **Codex SQLite (`state_5.sqlite`)**: SQLite in WAL mode allows concurrent readers, but the Codex CLI holds a write lock on checkpoints. A reader that opens the database with `SQLITE_OPEN_READWRITE` while Codex holds a write lock will receive `SQLITE_BUSY` and fail. Even WAL mode does not prevent all conflicts: the wal-index lock is briefly exclusive during checkpointing.
- **Claude Code JSONL**: Append-only writes mean the file can be read while being written, but a reader that reads the last line mid-write will receive a truncated JSON object (the last line is incomplete until the write is flushed).
- **Codex rollout JSONL**: Same truncated-last-line problem. The last event in a live rollout is not yet complete.

These are transient errors but they manifest as hard parse failures if not handled.

### Warning Signs

- Import fails with `Error: database is locked` during Codex SQLite reads.
- Scan returns a `SyntaxError: Unexpected end of JSON input` on the last line of a Claude JSONL file that was being written to during scan.
- Tests that simulate concurrent writes intermittently fail.

### Prevention Strategy

**For SQLite**: Open Codex `state_5.sqlite` as read-only: `SQLITE_OPEN_READONLY`. This prevents XBE from accidentally writing to the Codex database and eliminates wal-index write contention. Implement retry-with-backoff for `SQLITE_BUSY`:

```typescript
// Retry on SQLITE_BUSY up to 3 times with 100ms, 300ms, 500ms backoff
const withBusyRetry = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.retry({
      times: 3,
      schedule: Schedule.exponential("100 millis"),
      while: (error) => isSqliteBusyError(error),
    }),
  );
```

**For JSONL**: Treat a truncated last line as a recoverable error. When `JSON.parse` throws on the last line of a JSONL file, skip that line and report the thread as partially complete rather than failing the entire import.

```typescript
for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    const record = JSON.parse(trimmed);
    yield record;
  } catch {
    // Last line may be truncated due to concurrent write. Skip silently.
    skippedLines++;
  }
}
```

Do not hold file handles open across the scan-to-import gap. Open, read, and close within each operation. Do not cache file handles between `scan` and `preview` calls.

---

## Pitfall 8: Path Encoding Edge Cases in Claude Code's Directory Layout

**Severity: HIGH**

### Problem

Claude Code encodes the workspace path (current working directory) into the directory name under `~/.claude/projects/`. The encoding replaces `/` with `-`. This encoding is **lossy**: it cannot be reversed unambiguously.

Examples of encoding collisions:

- `/home/user/projects/foo` → `projects-foo`
- `/home/user/projects-foo` → `projects-foo`
- `/home/user/projects/foo-bar` → `projects-foo-bar`
- `/home/user/projects-foo-bar` → `projects-foo-bar`

All four paths produce the same encoded directory name. A scanner that assumes it can recover the original path from the encoded directory name will:
1. Match sessions from a different project (`/home/user/projects-foo`) to the current project (`/home/user/projects/foo`).
2. Miss sessions because the encoded name matches multiple candidates and the wrong one is selected.
3. Produce incorrect workspace filtering, surfacing sessions that belong to a different repository.

A secondary problem: on case-insensitive filesystems (macOS default), the encoding may further collide on case differences (`/home/user/Projects` and `/home/user/projects` both produce `projects`).

### Warning Signs

- A user has two projects, `/workspace/api` and `/workspace-api`, and the import dialog shows sessions from both when scanned for either.
- Decoded path appears to match but the session content references different files than the current workspace.
- On macOS, import results include sessions from a project in a different case-variant directory.

### Prevention Strategy

Do not attempt to decode the directory name back to a path. Instead, match by encoding the current workspace path using the same algorithm Claude Code uses and comparing the result to directory names:

```typescript
function encodeClaudeProjectPath(workspaceRoot: string): string {
  // Claude Code encodes the path by replacing all "/" separators with "-"
  // and stripping the leading "/"
  return workspaceRoot.replace(/\//g, "-").replace(/^-/, "");
}

function candidateDirectories(claudeProjectsDir: string, workspaceRoot: string): string[] {
  const encoded = encodeClaudeProjectPath(workspaceRoot);
  return [encoded]; // exact match only — never fuzzy match
}
```

Even with exact encoding, warn the user when a path collision is detected (two local directories encode to the same Claude path). Surface this in the UI as: "These sessions may belong to a different project with a similar path. Verify before importing."

For the case-insensitivity problem on macOS, normalize both sides to lowercase before comparison.

Store the encoded directory name (not the decoded path) in `history_import_catalog` as the canonical source identifier. Use it as part of the fingerprint computation to ensure re-scans after a path change do not collide.

---

## Pitfall 9: Context Compaction Events in Codex Rollouts

**Severity: HIGH**

### Problem

Codex CLI performs context compaction when the context window approaches its limit. A compaction event in the rollout JSONL:

1. Marks all preceding events as "replaced by compaction."
2. Inserts a synthetic summary event that represents the entire conversation up to that point as a single condensed message.
3. Subsequent events continue from the compacted context.

If a scanner imports all events naively (treating the rollout as a linear sequence of messages), it will:
- Import both the original uncompacted messages AND the synthetic compaction summary, duplicating the conversation content.
- Show the compaction summary as a message from the assistant, which looks like a jarring repetition or summary interruption mid-conversation.
- Miscalculate message counts (the "before" and "after" sections double-count the compacted range).

A second compaction edge case: a rollout may have multiple compaction events if the session ran long enough to compact twice. Each compaction invalidates the events before it.

### Warning Signs

- Imported Codex threads contain a message that starts with "Here's a summary of our conversation so far:" followed by a condensed recap, then the conversation continues normally.
- Message count in the catalog entry is significantly higher than the number of visible user/assistant turns (original + compacted events both counted).
- Tests using a rollout with a compaction event produce a thread with duplicate early messages.

### Prevention Strategy

Parse compaction events explicitly. When a compaction event is encountered, discard all previously parsed messages and restart the message list from the compaction summary:

```typescript
for (const event of rolloutEvents) {
  if (event.type === "context_compaction" || event.type === "compaction_summary") {
    // Discard all messages accumulated before this compaction.
    // The compaction summary IS the new conversation start.
    messages = [];
    if (event.summary_message) {
      messages.push(mapCompactionSummaryToMessage(event));
    }
    continue;
  }
  messages.push(mapRolloutEventToMessage(event));
}
```

Record the presence of compaction in the catalog entry metadata (e.g., `hasCompaction: true`, `compactionCount: N`). Surface this in the preview UI:

```
[i] This session underwent context compaction. Earlier history before the compaction
    boundary may not be fully available. N messages shown.
```

Do not import pre-compaction events as secondary messages — this misleads the user into thinking they have the full history when they only have a summary. An honest "starts from compacted context" is more trustworthy than a false "complete history."

---

## Pitfall 10: UX Pitfalls — Cluttered Thread Lists and Ambiguous Resumability

**Severity: HIGH**

### Problem

Importing all discovered sessions without user filtering can flood the thread list with hundreds of stale conversations from months ago. Users who open XBE to start a new session find the thread list dominated by old imported history. Specific failure modes:

1. **Thread list performance**: The existing projector caps `messages` at `MAX_THREAD_MESSAGES = 2_000` and `checkpoints` at `MAX_THREAD_CHECKPOINTS = 500`. But the thread list query fetches all threads, and with 300+ imported threads, the `getSnapshot` response becomes very large, making initial load slow.

2. **Resumability confusion**: Imported Claude Code and Gemini threads cannot be natively resumed through the Codex app-server (they use a different protocol). Users who click "Continue" on an imported Claude thread expect it to pick up from where it left off, but XBE can only start a new Codex session. The user sees a blank new turn with no original context.

3. **Stale badge proliferation**: If every imported thread shows a "validate link" badge, the thread list becomes visually noisy. Users learn to ignore badges entirely, making the badge useless.

4. **Title collision**: If the provider does not store a title for the session (Claude Code sessions often have no title), the import will either show a blank title or fall back to the first user message. If many sessions start with "help me" or "write a function", the thread list shows dozens of identically-named threads.

### Warning Signs

- A user who imports 200 Codex sessions reports that XBE takes 10+ seconds to load.
- Bug report: "I clicked Continue on an imported Claude thread and it started a brand new empty conversation."
- User feedback: "All my imported threads say 'Stale link — validate' and I don't know what it means."
- Thread list shows 50 threads all titled "help me with this code."

### Prevention Strategy

**Cluttered list**: Default the import UI to show only the last 30 sessions per provider. Require explicit user action to show older sessions. Sort by `updatedAt` descending. Do not bulk-import all sessions — require per-session selection.

**Resumability**: Distinguish thread resumability clearly at import time. Set a `resumeCapability` field in the external link record:
- `"native"`: Codex threads with a known `providerThreadId` that can be passed to `thread/resume`.
- `"replay"`: Claude Code threads where XBE can replay the context as a new Codex session (inject as user/assistant message pairs).
- `"read-only"`: Gemini threads where no resume is possible (no compatible runtime).

In the thread UI, show the appropriate action label:
- Native: "Continue in Codex" (uses `thread/resume`)
- Replay: "Replay context and continue" (starts new session with injected history)
- Read-only: "View only — cannot continue" (greyed out continue button with tooltip)

**Stale badge**: Only show the validate badge when the user navigates to the thread. Do not show it on every thread in the list. Run link validation lazily on thread open, not on list render.

**Title generation**: For sessions without a title, derive a title from: model name + date + first user message (truncated to 60 chars). Use the same `truncateTitle` logic already present at `apps/web/src/truncateTitle.ts`.

---

## Pitfall 11: Streaming and Incomplete Messages from Sessions Ended Mid-Stream

**Severity: MEDIUM**

### Problem

If the CLI process was killed, crashed, or the user interrupted a session mid-stream, the JSONL file may contain:

- A streaming message event with a delta but no corresponding `complete` event.
- A turn start event with no corresponding turn end event.
- A tool call request event with no result event.

If these partial records are imported as-is, the XBE thread will contain a message with `streaming: true` permanently. The existing projector sets `streaming: true` when a `thread.message-sent` event has `streaming: true`, and only sets it to `false` when a subsequent `complete` event arrives. An imported thread where the last message is permanently streaming will:
- Show the loading spinner on the last message indefinitely.
- Block the "Continue" action (the session appears to be in a running state).
- Potentially confuse the decider if a future turn is started while the last message is "streaming."

### Warning Signs

- Imported thread shows a spinning loading indicator on the last assistant message.
- "Continue" button is disabled with the message "Session in progress."
- The last message in an imported thread has only partial text — e.g., cuts off mid-sentence.
- A test that imports a fixture with a truncated session produces a thread in a perpetual streaming state.

### Prevention Strategy

At the end of JSONL parsing, before dispatching to the orchestration engine, scan for any message in `streaming: true` state (delta received but no complete event). Force-complete these messages:

```typescript
function finalizeImportedMessages(messages: ImportedMessage[]): ImportedMessage[] {
  return messages.map((msg) => ({
    ...msg,
    // If no explicit complete event was found, mark as complete (not streaming)
    streaming: false,
    // Append a note if the message was visibly truncated
    text: msg.wasInterrupted
      ? `${msg.text}\n\n[Session interrupted — message may be incomplete]`
      : msg.text,
  }));
}
```

Similarly, treat any open turn (started but never completed) as a completed turn with the final state derived from the last available event. An incomplete turn is not a streaming turn — it is a completed-with-interruption turn.

Mark interrupted sessions in the catalog entry (`wasInterrupted: true`) and surface a note in the preview:

```
[!] This session was interrupted before completing. The last message may be truncated.
```

---

## Pitfall 12: Subagent and Sidechain Sessions Mixed with Main Sessions

**Severity: MEDIUM**

### Problem

Codex, Claude Code, and future agents support spawning subagent sessions to delegate sub-tasks. These subagent sessions create their own session files with different session IDs but may be stored in the same directories as main sessions:

- **Claude Code**: A subagent spawned by a main session creates a new `.jsonl` file in the same `~/.claude/projects/<path>/` directory. The files are indistinguishable from main session files by directory location alone.
- **Codex**: Subagent rollouts may be stored with a different `parentSessionId` field in the rollout metadata. Old Codex versions omit this field entirely.

If the scanner treats all files in the directory as top-level conversations, the thread list fills with subagent micro-sessions that users never interacted with directly. These are typically:
- Very short (2–5 messages).
- Focused on a narrow sub-task ("edit this one function").
- Not meaningful in isolation — they only make sense in the context of the parent session.

Surfacing them as first-class threads confuses users who do not recognize these sessions and cannot understand why they have 200 imported threads when they remember only 20 sessions.

A related but distinct problem: Claude Code stores multi-turn agent interactions (extended tool loops) as a single session. The subagent sessions it spawns may reference the parent session ID in their JSONL. If the scanner does not correlate these, the user sees both the parent session and several subagent sessions as separate threads.

### Warning Signs

- Import dialog shows 5x more sessions than the user expects.
- Many imported threads have only 2–3 messages and titles that look like sub-tasks ("Update the return type of doFoo").
- A user who had 20 Claude Code sessions reports 87 threads after import.
- Sessions with `parentSessionId` in metadata are shown as standalone threads.

### Prevention Strategy

Filter out sessions that have a `parentSessionId` field set. These are subagent sessions and should be excluded from the top-level import list by default.

For Claude Code, use heuristics to identify subagent sessions when `parentSessionId` is absent (older format):
- Message count < 5 AND first user message contains tool-invocation patterns (e.g., "Read file X", "Edit function Y").
- Session duration < 60 seconds (start to end timestamp).
- No user-authored message (all "user" messages are actually tool responses injected by the parent agent).

Offer an "advanced" import option that includes subagent sessions, defaulting to off. If included, group subagent sessions under their parent in the import UI rather than showing them as standalone entries.

In the catalog, record `isSubagent: boolean` and `parentSessionId: string | null` as metadata fields. This allows the UI to show a hierarchy view in a future version.

---

## Summary Matrix

| # | Pitfall | Severity | Key Prevention |
|---|---------|----------|----------------|
| 1 | Large file memory — 70MB JSONL loaded into memory | CRITICAL | Stream line-by-line; never buffer full file |
| 2 | Provider format versioning / breaking changes | HIGH | Defensive schema decode; format version in catalog |
| 3 | Timestamp ordering bugs across providers | HIGH | Normalize to UTC ISO at parse time; sort explicitly |
| 4 | Duplicate import and re-import | HIGH | `providerThreadId` index; dedup before dispatch |
| 5 | Partial failure recovery — ghost threads | HIGH | `importStatus` in catalog; surface partial imports |
| 6 | Encrypted/opaque fields (Codex encrypted_content) | MEDIUM | Skip encrypted fields; map to activity entry |
| 7 | File locking with active CLI sessions | HIGH | Read-only opens; retry on SQLITE_BUSY; skip truncated last line |
| 8 | Path encoding edge cases (Claude Code lossy encoding) | HIGH | Encode current path forward; never decode backward |
| 9 | Context compaction events (Codex) | HIGH | Discard pre-compaction events when compaction encountered |
| 10 | UX — cluttered lists, resumability confusion | HIGH | Scope defaults; resumeCapability field; lazy link validation |
| 11 | Streaming/incomplete messages from interrupted sessions | MEDIUM | Force-complete all messages at parse finalization |
| 12 | Subagent/sidechain sessions mixed with main sessions | MEDIUM | Filter `parentSessionId`; default-exclude subagent sessions |

---

## Interaction Effects

Several pitfalls interact and must be solved together:

- **Pitfalls 1 + 9**: Codex compaction events can only be correctly detected by reading the full rollout file in sequence. But the file may be 70MB. These must be solved together: stream line-by-line while tracking compaction state.

- **Pitfalls 5 + 3**: Partial failure recovery relies on knowing the last-successfully-imported message position. That position depends on correctly normalized timestamps (Pitfall 3). If timestamps are wrong, the resume-from-offset logic in Pitfall 5 will re-import already-imported messages or skip new ones.

- **Pitfalls 4 + 12**: Deduplication by `providerThreadId` does not help if subagent sessions (Pitfall 12) are imported as separate threads — each subagent session has its own unique ID and will not be detected as a duplicate of the parent. The subagent filter (Pitfall 12) must run before deduplication (Pitfall 4).

- **Pitfalls 8 + 2**: Path encoding changes (Pitfall 8) are a specific instance of format versioning (Pitfall 2). If Claude Code ever changes its path encoding algorithm, all existing catalog entries will be orphaned. Handle by storing the raw encoded directory name in the catalog rather than the decoded path.

---

## Sources

- XBE Code codebase:
  - `/home/danil.morozov/Workspace/t3code/apps/server/src/orchestration/projector.ts` — `MAX_THREAD_MESSAGES = 2_000`, message capping logic
  - `/home/danil.morozov/Workspace/t3code/apps/server/src/orchestration/Layers/OrchestrationEngine.ts` — serial command queue, transaction boundary, partial failure reconciliation
  - `/home/danil.morozov/Workspace/t3code/apps/server/src/persistence/Layers/Sqlite.ts` — WAL mode setup, single SQLite database
  - `/home/danil.morozov/Workspace/t3code/packages/contracts/src/orchestration.ts` — `ThreadCreateCommand`, `ThreadMessageAssistantDeltaCommand`, `ThreadMessageAssistantCompleteCommand`, `OrchestrationThread`
  - `/home/danil.morozov/Workspace/t3code/apps/server/src/provider/gemini/GeminiTranscript.ts` — transcript turn model, serialization
  - Architecture research: `/home/danil.morozov/Workspace/t3code/.planning/research/ARCHITECTURE.md`
  - Feature research: `/home/danil.morozov/Workspace/t3code/.planning/research/FEATURES.md`
- External sources:
  - Codex rollout format and SQLite state: https://deepwiki.com/openai/codex/3.7-memory-system
  - Codex context compaction changelog: https://github.com/openai/codex (CHANGELOG entries for compaction feature)
  - Claude Code session storage: https://kentgigger.com/posts/claude-code-conversation-history
  - Gemini CLI hash-to-slug migration: https://github.com/google-gemini/gemini-cli/discussions/4974
  - SQLite WAL concurrency: https://www.sqlite.org/wal.html

---

*Pitfalls research for: File-based chat history import — XBE Code*
*Researched: 2026-03-12*
