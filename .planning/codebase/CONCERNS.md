# Codebase Concerns

**Analysis Date:** 2026-03-12

## Overview

This document captures technical debt, known bugs, security considerations, and fragile areas in the XBE Code codebase. These items are tracked in `.plans/16c-pr89-remediation-checklist.md` with detailed context. Active issues total **51** (33 valid, 18 partially-valid); 6 invalid items have been closed.

---

## Tech Debt

### Unbounded Memory Growth in Turn Start Deduplication (C018)

**Issue:** The `handledTurnStartKeys` cache in `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:84` has a fixed capacity but no pruning of expired entries between the TTL checks. Under high turn-start volume, memory can accumulate if entries approach the maximum capacity.

**Files:** `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`

**Impact:** Long-running server sessions may experience gradual memory growth that accumulates over days/weeks of operation. Not immediately critical but becomes a concern for 24/7 deployments.

**Fix approach:**
- Implement active cleanup of expired cache entries, or
- Reduce `HANDLED_TURN_START_KEY_MAX` (currently 10,000) if memory is constrained
- Consider using a LRU cache with automatic eviction instead of time-based TTL

---

### Duplicated Workspace CWD Resolution Logic (C042, C043)

**Issue:** The `resolveThreadWorkspaceCwd` function is duplicated across three files, and general workspace resolution logic is repeated in reactor modules.

**Files:**
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts:62`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/checkpointing/Utils.ts`

**Impact:** Maintenance burden; bug fixes must be applied in multiple places. One instance contains variant logic making consolidation non-trivial.

**Fix approach:**
- Centralize non-variant resolution to a shared utilities module
- Extract variant logic to separate named functions with clear intent
- Update all import sites to use the centralized version

---

### Unused/Unpruned State Maps (C046)

**Issue:** `latestMessageIdByTurnKey` in `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts:133` is written to but never read. `clearAssistantMessageIdsForTurn` doesn't clear its entries—only `clearTurnStateForSession` does, creating a retention gap.

**Files:** `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`

**Impact:** Low practical impact currently, but indicates incomplete cleanup logic that could lead to bugs if the map is later used.

**Fix approach:**
- Remove the unused map if it serves no future purpose, or
- Ensure it's cleared alongside `turnMessageIdsByTurnKey` in `clearAssistantMessageIdsForTurn`

---

## Known Bugs

### Git Braced Rename Syntax Not Parsed Correctly (C009)

**Issue:** Git's braced rename syntax (e.g., `src/{old => new}/file.ts`) produces invalid paths. The current slice after ` => ` produces `new}/file.ts` instead of the full destination path.

**Files:** `apps/server/src/git/Layers/GitCore.ts:41`

**Trigger:** Running git commands that use braced rename syntax (common in bulk refactors).

**Impact:** File path operations fail or operate on wrong paths. Worktree creation, diffs, and checkouts may be incorrect.

**Workaround:** None—requires fix.

**Fix approach:**
- Detect brace patterns in the rename and expand them before processing
- Construct the full destination path by replacing `{old => new}` with just `new`
- Test with real git renames like: `git mv src/{old => new}/file.ts`

---

### Missing Keybindings Config File Handling (C010)

**Issue:** Loading custom keybindings fails when the config file doesn't exist, which is normal for new users. The code should catch `ENOENT` and return empty defaults.

**Files:** `apps/server/src/keybindings.ts:418`

**Trigger:** First-time user with no custom keybindings config file yet created.

**Impact:** Keybindings initialization error on fresh installs or when config is deleted.

**Workaround:** Manually create the config file with empty keybindings.

**Fix approach:**
- Wrap file read in try-catch for `ENOENT`
- Return empty array or default keybindings on file not found
- Create parent directory if needed (e.g., `~/.xbe/config/`)

---

### Fish Shell PATH Parsing (C022, C023)

**Issue:** Fish shell outputs `$PATH` as space-separated, not colon-separated. Additionally, using `-il` flags causes sourcing of profile scripts that may print banners, polluting captured output.

**Files:** `apps/server/src/os-jank.ts:10`

**Trigger:** Running on macOS or Linux with fish as the default shell.

**Impact:** Malformed `PATH` environment variable leads to command not found errors or broken shell operations.

**Workaround:** Switch to zsh or bash as default shell.

**Fix approach:**
- Detect if shell is fish: check `$SHELL` contains "fish"
- Use `string join : $PATH` syntax for fish instead of standard colon format
- Replace `-il` with `-lc` (login without interactive) to avoid profile pollution
- Validate result contains colons before assigning

---

### Multi-byte UTF-8 Character Split Across Chunks (C038, C054)

**Issue:** When array chunks contain multi-byte UTF-8 characters split across boundaries, decoding each chunk separately produces replacement characters (U+FFFD).

**Files:**
- `apps/server/src/git/Layers/CodexTextGeneration.ts:136`
- `apps/server/src/wsServer.ts:104`

**Trigger:** Streaming text output containing emoji, CJK characters, or other multi-byte sequences that happen to split at chunk boundaries.

**Impact:** Garbled text in git diffs, code generation output, or WebSocket messages containing non-ASCII characters.

**Workaround:** None—characters are already corrupted by time of detection.

**Fix approach:**
- Accumulate all chunks first, then decode once: `Buffer.concat(chunks).toString("utf8")`
- Or use `TextDecoder` with `stream: true` option to handle split sequences
- Add test cases with emoji and CJK characters

---

### External Scheme Pattern Misclassification (C030)

**Issue:** `EXTERNAL_SCHEME_PATTERN` in `apps/web/src/markdown-links.ts:111` matches `script.ts:10` as a scheme because `.ts:` looks like `scheme:`. The regex doesn't require `://` after the colon.

**Files:** `apps/web/src/markdown-links.ts:111`

**Trigger:** Displaying or parsing markdown links with file paths like `path/script.ts:10` (line references).

**Impact:** File paths with line numbers are incorrectly treated as external URLs and opened in browser instead of editor.

**Workaround:** None—requires regex fix.

**Fix approach:**
- Require `://` after scheme: `/[a-z][a-z0-9+.-]*:\/\//i`
- Or check that what follows `:` is not just digits (avoid matching `:10`)
- Test with: `script.ts:10`, `http://example.com`, `file:///path`, etc.

---

### PTY Process Race Condition (C052)

**Issue:** In `apps/server/src/terminal/Layers/BunPTY.ts:97`, `processHandle` may be `null` when the `data` callback fires, since it's assigned after `Bun.spawn` returns. Early data output can be lost.

**Files:** `apps/server/src/terminal/Layers/BunPTY.ts:97`

**Trigger:** Spawning a PTY process whose initial output arrives immediately (common in short-lived commands).

**Impact:** Terminal output loss for early command output. Commands may appear to have produced no output.

**Workaround:** None—requires code restructuring.

**Fix approach:**
- Initialize `BunPtyProcess` before passing callbacks to `Bun.spawn`
- Build the process object with callback closure over itself
- Ensure data events route to the correct process handle immediately

---

## Security Considerations

### Double URL Decoding (C029)

**Issue:** `parseFileUrlHref` in `apps/web/src/markdown-links.ts:105` already decodes the path, but `safeDecode` is called again, corrupting filenames containing `%` sequences (e.g., `file%20name.txt` becomes `file name.txt`, then decoding again produces invalid UTF-8).

**Files:** `apps/web/src/markdown-links.ts:105`

**Risk:** Filenames with `%` characters are corrupted, breaking ability to open files. Could be exploited to make files inaccessible.

**Current mitigation:** Pattern is isolated to markdown link handling; not a network input vector.

**Recommendations:**
- Skip second decode when `fileUrlTarget` is non-null
- Add test cases for filenames with `%`, `%20`, `%25`, etc.
- Review all decode call sites for similar double-decoding issues

---

### Keybinding Rule Race Condition (C040)

**Issue:** `upsertKeybindingRule` in `apps/server/src/keybindings.ts:488` implements a read-modify-write sequence without synchronization. Concurrent calls can lose updates.

**Files:** `apps/server/src/keybindings.ts:488`

**Risk:** Multiple clients updating keybindings simultaneously will have writes lost. Not currently exposed to concurrent user input but could be triggered by bulk operations or scripting.

**Current mitigation:** Low practical exposure in typical user workflows.

**Recommendations:**
- Wrap read-modify-write with `Effect.Semaphore` to serialize access
- Or implement optimistic locking with version field
- Add test case for concurrent updates

---

## Performance Bottlenecks

### Oversized React Components

**Issue:** `apps/web/src/components/ChatView.tsx` is 6,212 lines—far beyond maintainability and performance thresholds. Component rerender cost is high due to size.

**Files:** `apps/web/src/components/ChatView.tsx`

**Current capacity:** 6,212 lines

**Scaling path:**
- Split into smaller focused components: message list, composer, sidebar interactions
- Extract custom hooks for state management logic (message formatting, turn state, etc.)
- Use React.memo for expensive sub-components
- Consider splitting into separate route-level components

---

### Sidebar Resizable Object Recreation (C057)

**Issue:** In `apps/web/src/routes/_chat.$threadId.tsx:105`, the `resizable` object is recreated on every render, causing `SidebarRail`'s `useEffect` to repeatedly read localStorage and update the DOM.

**Files:** `apps/web/src/routes/_chat.$threadId.tsx:105`

**Impact:** Unnecessary DOM updates and localStorage I/O on every parent rerender, even if sidebar state hasn't changed.

**Fix approach:**
- Wrap `resizable` with `useMemo` to stabilize the object reference
- Depend only on configuration changes, not all parent rerenders

---

### Sidebar Width Initialization Bug (C058)

**Issue:** In `apps/web/src/routes/_chat.$threadId.tsx:122`, when `localStorage.getItem()` returns `null`, `Number(null)` evaluates to `0`, which passes `Number.isFinite(0)`. This forces the sidebar to `minWidth` on first load, overriding CSS clamp defaults.

**Files:** `apps/web/src/routes/_chat.$threadId.tsx:122`

**Impact:** Sidebar width on first load ignores CSS defaults, creating visual inconsistency between first visit and subsequent loads.

**Fix approach:**
- Guard against null: `if (storedWidth === null || storedWidth === '') return undefined`
- Use only the stored value if it's a valid number

---

## Fragile Areas

### Projection Pipeline Event Fallback Logic (C015)

**Issue:** Gap-filling fallback logic in `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:99` can retain messages from turns being deleted, but filtering prevents FK violations. Code is fragile to future changes.

**Files:** `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:99`

**Why fragile:**
- Fallback assumes external data consistency
- Comments about FK violations don't match current behavior
- Retention/deletion logic is hard to verify by reading code alone

**Safe modification:**
- Add integration test for turn deletion with fallback scenarios
- Document the exact guarantees: which messages are guaranteed safe to delete
- Add assertions in production code to catch retention violations early

**Test coverage:** Integration tests exist but scenarios are limited.

---

### Checkpoint Snapshot Projector Mismatch (C017)

**Issue:** `REQUIRED_SNAPSHOT_PROJECTORS` in `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:71` includes `pending-approvals` and `thread-turns`, but `getSnapshot` doesn't query their data. Clients replay already-applied events if projectors lag.

**Files:** `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:71`

**Why fragile:**
- Requires keeping two lists in sync manually
- Lag in one projector breaks snapshot semantics for all
- Current replay impact is lower due to idempotency, but fragile to future changes

**Safe modification:**
- Test with intentionally-slow projectors to verify replay behavior
- Filter `REQUIRED_SNAPSHOT_PROJECTORS` to match actual data fetched
- Document the consistency contract

**Test coverage:** Exists but not comprehensive for projector lag scenarios.

---

### In-Memory Turn Start State Not Restored on Bootstrap (C016)

**Issue:** `pendingTurnStartByThreadId` in `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:490` is in-memory only and not rebuilt during bootstrap. If service restarts after `thread.turn-start-requested` but before `thread.session-set`, pending state is lost.

**Files:** `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:490`

**Impact:** Turn start state is lost on restart, potentially causing orphaned UI states or incomplete turn handling.

**Safe modification:**
- Rebuild pending state from event log during bootstrap by scanning for unmatched `turn-start-requested` events
- Or make pending state persistent to a state table
- Add test case: crash after `turn-start-requested` but before `session-set`, verify state on restart

**Test coverage:** Not covered.

---

### CheckpointStore Input Normalization Inconsistency (C008)

**Issue:** `CheckpointStore` methods inconsistently normalize input (trim/validate). While contracts are edge-defined via schemas, internal repository boundaries remain loose.

**Files:** `apps/server/src/checkpointing/Layers/CheckpointStore.ts:94`

**Why fragile:**
- Callers must know which methods need pre-normalization
- Easy to miss one method when adding a new caller
- No runtime validation

**Safe modification:**
- Document which methods expect normalized input
- Consider adding a private `normalize()` method called by all public methods
- Add assertions in test suite for boundary conditions

**Test coverage:** Exists but boundary-focused tests are light.

---

### Sidebar State Control Flow (C056)

**Issue:** In `apps/web/src/components/ui/sidebar.tsx:114`, when `onOpenChange` is provided without `open`, the internal `_open` state never updates because `setOpenProp` takes precedence. This creates an internal state consistency bug.

**Files:** `apps/web/src/components/ui/sidebar.tsx:114`

**Why fragile:**
- Coupling between `openProp` and `setOpenProp` is implicit
- Current callsites mostly avoid triggering the bug but future changes could expose it

**Safe modification:**
- Call `_setOpen` when `openProp === undefined`, regardless of `setOpenProp` existence
- Add test case: `<Sidebar onOpenChange={handler} />` without `open` prop

---

## Test Coverage Gaps

### Server Terminal Operations (BunPTY)

**What's not tested:** Race conditions in PTY data handling, chunk boundaries with multi-byte UTF-8, early output loss.

**Files:** `apps/server/src/terminal/Layers/BunPTY.ts`

**Risk:** Terminal output corruption or loss goes unnoticed until user reports missing output.

**Priority:** Medium (C052 affects real workflows)

---

### Git Edge Cases

**What's not tested:**
- Braced rename syntax (`src/{old => new}/file.ts`)
- File paths with `%` characters
- Non-ASCII filenames in diffs

**Files:**
- `apps/server/src/git/Layers/GitCore.ts`
- `apps/web/src/markdown-links.ts`

**Risk:** Edge-case files fail to be processed correctly. Bulk refactors or international projects hit hidden bugs.

**Priority:** Medium (C009 confirmed broken)

---

### WebSocket Protocol Robustness

**What's not tested:** UTF-8 character split across chunk boundaries, malformed JSON-RPC, network disconnects mid-stream.

**Files:** `apps/server/src/wsServer.ts`

**Risk:** Unicode output is corrupted; server crashes or becomes unresponsive under adverse network conditions.

**Priority:** Low (C054 unlikely in practice but possible)

---

### Keybindings Configuration Edge Cases

**What's not tested:**
- Missing config file (new user)
- Corrupted JSON in config
- Concurrent modifications
- Fish shell PATH parsing

**Files:** `apps/server/src/keybindings.ts`

**Risk:** Keybindings fail to load or become corrupted on first setup. User loses customizations.

**Priority:** Medium (C010, C022, C023 affect actual use cases)

---

### State Consistency After Crashes

**What's not tested:** Server restart after partial event application, projector lag during snapshot, turn state recovery.

**Files:**
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`

**Risk:** Silent data loss or inconsistency that manifests as duplicate messages, missing turns, or phantom state.

**Priority:** High (C016, C017 affect correctness)

---

## Scaling Limits

### In-Memory Caches Without Bounds

**Resource:** Turn start deduplication cache (`handledTurnStartKeys`)

**Current capacity:** 10,000 entries with 30-minute TTL

**Limit:** Memory grows linearly with concurrent session count. At 100+ simultaneous turns/min with peak load, cache approaches capacity.

**Scaling path:**
- Implement LRU eviction with lower capacity (e.g., 5,000)
- Or persist cache to SQLite to move overhead to disk
- Monitor memory usage in production and alert on growth

---

### Event Store Append Without Transactions

**Resource:** Sequence of event appends in `OrchestrationEngine`

**Current limitation:** Non-atomic append+project+receipt can duplicate events on retry.

**Limit:** At scale, duplicates accumulate and break idempotency assumptions.

**Scaling path:**
- Implement transaction wrapping for append+receipt
- Or use deterministic event IDs derived from commandId to make retries safe
- Add integration test with failure injection at each step

---

## Dependencies at Risk

### Effect.js Library Adoption

**Risk:** Heavy reliance on `@effect/` ecosystem (Queue, PubSub, Stream, Cache, etc.). Library is still evolving; API breaking changes possible in minor versions.

**Impact:** Async/concurrent code is tightly coupled to Effect. Migration would be expensive.

**Mitigation:**
- Pin Effect version to exact semver (already done in package.json)
- Isolate Effect usage behind adapter/wrapper layers where possible
- Monitor Effect releases for deprecation warnings

---

## Missing Critical Features

### Distributed State Consistency

**Problem:** All state is in-memory and server-resident. No replication, clustering, or leader election.

**Blocks:** Running multiple server instances, geographic distribution, failover.

**Current scope:** Single-machine deployment only. Acceptable for WIP but limits production scale.

---

### Concurrency Control for Keybindings

**Problem:** Read-modify-write race condition exists in `upsertKeybindingRule`.

**Blocks:** Safe concurrent keybinding updates from multiple clients or scripts.

**Current scope:** Low practical impact but architectural issue.

---

### File URL Decoding Correctness

**Problem:** Double-decoding corrupts filenames with `%` characters.

**Blocks:** Opening files with `%` in their names.

**Current scope:** Edge case but manifests as user-facing bug.

---

## Issues by Severity

### High Severity

- **C001**: Non-atomic event appending can corrupt state on retry (DONE)
- **C002**: Event dispatch error terminates ingestion loop (DONE)
- **C003**: Unhandled WebSocket errors crash process (DONE)

### Medium Severity (Open)

- **C009**: Git braced rename syntax broken → produces invalid paths
- **C010**: Missing keybindings config file causes error → should default
- **C016**: Pending turn state lost on restart → not persisted
- **C017**: Snapshot projector mismatch → clients replay old events
- **C018**: Unbounded memory growth in turn dedup → cache never shrinks
- **C019**: Event routing races under session rebinds → wrong thread context
- **C022**: Fish shell PATH parsing broken → space-separated not colon
- **C023**: Shell invocation flags pollute captured output → interactive mode
- **C028**: Branch sync dual dispatch → optimistic+server both fire
- **C038**: Multi-byte UTF-8 split across chunks → garbled output
- **C047**: Error type mapping inconsistency → decode errors buried
- **C050**: Session update race condition → lost concurrent writes
- **C054**: WebSocket chunk UTF-8 corruption → replacement characters

### Low Severity (Open)

- **C038**: Same as medium but in different file
- **C047**: Decode errors grouped with SQL errors
- **C050**: Concurrent session upsert race
- **C052**: PTY data callback races before handle assignment
- **C056**: Sidebar state control flow inconsistency
- **C057**: Resizable object recreated per render
- **C058**: localStorage null coercion forces min width
- **C060**: defaultModel patch can't clear to null

---

*Concerns audit: 2026-03-12*
*Source: `.plans/16c-pr89-remediation-checklist.md` + codebase analysis*
