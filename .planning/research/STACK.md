# Stack Research: File-Based Chat History Import/Parsing

**Domain:** JSONL/JSON import, SQLite read-only access, FS scanning, fingerprinting for developer tool chat history
**Researched:** 2026-03-12
**Codebase revision:** effect-smol `8881a9b` (effect v4 pre-release catalog pin)
**Confidence:** HIGH — grounded in installed source code inspection, official documentation, and cross-referenced against established patterns in the existing codebase.

---

## Context

XBE Code needs to import conversation history from three providers. Each has a distinct storage format and access hazard:

| Provider | Path | Format | Hazard |
|----------|------|--------|--------|
| Claude Code | `~/.claude/projects/<path-slug>/<session-id>.jsonl` | JSONL, up to 70 MB per file | File may be actively written during import |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `~/.codex/state_5.sqlite` | JSONL rollouts + WAL-mode SQLite metadata | SQLite locked by Codex process; two JSONL format versions coexist |
| Gemini CLI | `~/.gemini/tmp/<project-hash>/chats/<session>.json` | One JSON object per file | Hash-to-slug path migration across Gemini versions |

The server runs on Node.js 24 / Bun 1.3.9 and uses Effect-TS (effect-smol `8881a9b`), which is an unreleased v4 pre-release. All new code must fit the existing Effect service/layer architecture.

---

## 1. JSONL/JSON Streaming Parsers for Large Files

### Recommendation: Effect `FileSystem.stream` + `Stream.decodeText` + `Stream.splitLines` + `JSON.parse` per line

**Confidence: HIGH**

The entire required toolkit is already present in the installed version of effect-smol. No external library is needed.

```typescript
import { FileSystem, Path } from "@effect/platform-node"
import { Effect, Stream } from "effect"

const parseJSONLFile = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return fs.stream(filePath, { chunkSize: FileSystem.KiB(64) }).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.filter((line) => line.trim().length > 0),
      Stream.mapEffect((line) =>
        Effect.try({
          try: () => JSON.parse(line) as unknown,
          catch: (cause) => new ParseError({ line, cause }),
        })
      ),
    )
  }).pipe(Stream.unwrap)
```

**Rationale:**

- `FileSystem.stream` (from `effect/FileSystem`, confirmed in installed source at `apps/server/node_modules/.bun/effect@.../src/FileSystem.ts`) returns `Stream<Uint8Array, PlatformError>`. It already handles chunked reads and exposes `chunkSize` and `offset`/`bytesToRead` options. Chunk size defaults to 64 KB; for 70 MB files this produces ~1,100 chunks with zero full-file allocation.
- `Stream.decodeText()` handles multi-byte UTF-8 across chunk boundaries correctly (fixed in recent effect releases; confirmed in `Stream.ts` source).
- `Stream.splitLines` handles both `\n` and `\r\n` line endings.
- Per-line `JSON.parse` is sufficient for JSONL. Each Claude Code line is a single complete JSON object. Lines are typically 100 bytes to a few KB, never multi-line.
- The full pipeline is lazy, back-pressured, and integrated with Effect's structured concurrency and error model.

**What NOT to use:**

- `fs.readFile` / `fs.readFileString` — loads the entire file into the heap. 70 MB per concurrent import, GC pressure, OOM risk on multi-session imports. Do not use.
- `Bun.JSONL.parseChunk` — Bun-specific; server code must run under both Bun and Node.js (see `engines` field in `apps/server/package.json`: `"node": "^22.13 || ^23.4 || >=24.10"`). Use as a fast-path optimization only if profiling reveals that `JSON.parse` is a bottleneck and the import path is known to be Bun-only.
- `stream-json` (npm) — useful when parsing a single large JSON object (not JSONL). Unnecessary here since JSONL is already line-delimited. Adds a dependency for no benefit.
- `readline.createInterface` (node:readline) — viable fallback but bypasses the Effect stream model. Event-based API requires manual bridging to Effect Streams via `Stream.fromEventEmitter` or similar. More integration surface area than the pure-Effect approach.

---

## 2. Bun.JSONL Built-In (Secondary Option)

**Confidence: MEDIUM — Bun-only**

Bun v1.2+ ships `Bun.JSONL.parse(text)` (batch) and `Bun.JSONL.parseChunk(buffer, start?, end?)` (streaming, returns `{ values, read, done, error }`). `parseChunk` returns consumed byte offset enabling zero-copy buffer slicing.

```typescript
// Bun-only streaming pattern:
let buf = new Uint8Array(0)
for await (const chunk of bunFileStream) {
  const newBuf = new Uint8Array(buf.length + chunk.length)
  newBuf.set(buf)
  newBuf.set(chunk, buf.length)
  buf = newBuf
  const result = Bun.JSONL.parseChunk(buf)
  for (const value of result.values) { /* process */ }
  buf = buf.subarray(result.read)
}
```

**Use only if:** a profiled hot path shows that line-by-line `JSON.parse` is a bottleneck and the code is confirmed Bun-only. The Effect `FileSystem.stream` approach is the right default.

---

## 3. SQLite Read-Only Access (Codex `state_5.sqlite`)

### Recommendation: `node:sqlite` with `{ readOnly: true }` + `PRAGMA busy_timeout` + WAL-aware connection lifecycle

**Confidence: HIGH**

The codebase already has a custom `NodeSqliteClient` (`apps/server/src/persistence/NodeSqliteClient.ts`) built on `node:sqlite` (`DatabaseSync`) from Node.js 24. The `readonly` flag is already wired (`readOnly: options.readonly ?? false`). Use this existing abstraction directly.

```typescript
import { NodeSqliteClient } from "../../persistence/NodeSqliteClient.ts"
import { Effect } from "effect"

const CodexMetadataLayer = NodeSqliteClient.layer({
  filename: `${homedir()}/.codex/state_5.sqlite`,
  readonly: true,
})
```

**WAL mode considerations (grounded in SQLite 3.22.0+ documentation):**

Codex's SQLite database is very likely in WAL journal mode (Codex writes aggressively during sessions). Opening a WAL-mode database read-only is safe since SQLite 3.22.0 provided the `-shm` and `-wal` sidecar files either exist or the directory is writable for creation. Node.js 24's bundled SQLite is 3.45+.

Key behaviors to handle:

1. **SQLITE_BUSY on WAL recovery.** If the last Codex process crashed, the first reader triggers WAL recovery, which can emit `SQLITE_BUSY`. Set `PRAGMA busy_timeout = 5000` before any query to allow up to 5 seconds of automatic retry. This is a one-time pragma per connection.

2. **Read-only does not mean immutable.** Other connections (Codex itself) can write concurrently. Readers see a consistent snapshot at the start of their read transaction. Long-running read transactions can delay WAL checkpointing; keep transactions short.

3. **Do not open with `immutable=1` URI parameter.** That flag prevents reading a WAL database that has unsynchronized WAL content — it would miss recent sessions still in the WAL file.

Concrete setup within an Effect scoped layer:

```typescript
// Wrap the NodeSqliteClient layer with a one-time busy_timeout pragma
const withBusyTimeout = (client: SqlClient) =>
  Effect.gen(function* () {
    yield* client`PRAGMA busy_timeout = 5000`
    return client
  })
```

**What NOT to use:**

- `better-sqlite3` — native addon, requires compilation; `node:sqlite` is built-in to Node.js 22+ and already used throughout the codebase. No reason to add a native dep.
- `bun:sqlite` — Bun-only. Server must run under Node.js as well.
- `@effect/sql-sqlite-bun` — the catalog pins a version of this package, but the existing `NodeSqliteClient.ts` deliberately replaces it with a `node:sqlite`-based implementation. Follow the existing pattern.
- Opening with write access — do not do this. Even accidentally running `PRAGMA journal_mode = DELETE` on Codex's database would corrupt Codex's WAL chain.

---

## 4. File System Scanning

### Recommendation: `FileSystem.FileSystem.readDirectory` with manual recursion for targeted scans; `tinyglobby` for pattern-based discovery

**Confidence: HIGH**

Two use cases exist:

**4a. Targeted provider-specific scans (Claude Code, Codex, Gemini)**

Each provider stores files under a well-known root with shallow structure (1–3 levels deep). Use the Effect `FileSystem.FileSystem` service already in scope:

```typescript
const fs = yield* FileSystem.FileSystem

// List project directories under ~/.claude/projects/
const projectDirs = yield* fs.readDirectory(claudeProjectsRoot)

// For each project dir, list JSONL session files
for (const dir of projectDirs) {
  const sessionFiles = yield* fs.readDirectory(path.join(claudeProjectsRoot, dir))
  const jsonlFiles = sessionFiles.filter((f) => f.endsWith(".jsonl"))
  // ...
}
```

`FileSystem.readDirectory` returns `string[]` (entry names, not full paths). Use `FileSystem.stat` to get file size and mtime for pre-filtering oversized files or staleness checks.

**4b. Pattern-based discovery across arbitrary workspace trees**

If a glob-style scan is needed (e.g., `~/.codex/sessions/**/*.jsonl`), use `tinyglobby`. It wraps `fdir` (the fastest Node.js directory crawler, < 1 s for 1 M files) with a glob interface and is the 2025/2026 community standard, replacing `fast-glob` across major build tools.

```typescript
import { glob } from "tinyglobby"

const rolloutFiles = await glob("sessions/**/*.jsonl", {
  cwd: `${homedir()}/.codex`,
  absolute: true,
  onlyFiles: true,
})
```

`tinyglobby` is 179 KB install size vs. `fast-glob` at 513 KB. It is not yet in the monorepo — add it to `apps/server` as a dep if pattern-based scanning is needed.

The existing `workspaceEntries.ts` uses `fs.promises.readdir` with concurrency 32 for large workspace trees. For the provider scan use case (small, bounded trees), concurrency is not needed. For deep Codex session trees (organized by `YYYY/MM/DD`), `tinyglobby` is simpler than manual recursion.

**What NOT to use:**

- `glob` (npm legacy) — the old `glob` package uses a synchronous-optional API and a heavier dependency tree. `tinyglobby` supersedes it.
- `fast-glob` — still correct but community momentum has shifted to `tinyglobby` for new projects. `tinyglobby` is a direct replacement with a nearly identical API.
- `chokidar` — a file watcher, not a scanner. Do not use for one-shot discovery.
- `Bun.Glob` — Bun-specific; not available in Node.js.

---

## 5. Fingerprinting and Deduplication

### Recommendation: `crypto.createHash("sha256")` over the first and last N lines + file metadata composite key

**Confidence: HIGH**

The codebase already uses `node:crypto` for SHA-256 hashing (`apps/server/src/telemetry/Identify.ts`). No new dependency needed.

**Strategy: composite fingerprint**

A session file's identity for deduplication should be a composite of:

1. **Stable provider session ID** — extracted from the first line of the JSONL (e.g., `sessionId` in Claude Code, `sessionId` in Codex rollout header). Cheap O(1) read. Use as the primary deduplication key.
2. **File size + mtime** — from `fs.stat()`. Use as a fast staleness check: if size and mtime are unchanged since last catalog scan, skip full re-processing.
3. **Content fingerprint** — hash of first 4 KB + last 4 KB of the file (or first N lines + last N lines) using `crypto.createHash("sha256")`. This detects silent corruption and handles the (unlikely) case where a session ID is reused or mtime is unreliable (NFS, Docker volume mounts).

```typescript
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

async function fingerprintFile(filePath: string, fileSize: number): Promise<string> {
  const SAMPLE = 4096
  const hash = createHash("sha256")

  // Head sample
  await pipeChunks(createReadStream(filePath, { start: 0, end: SAMPLE - 1 }), hash)

  // Tail sample (only for files > 2 * SAMPLE)
  if (fileSize > 2 * SAMPLE) {
    await pipeChunks(createReadStream(filePath, { start: fileSize - SAMPLE }), hash)
  }

  // Include size in hash to distinguish same-content files of different lengths
  hash.update(String(fileSize))
  return hash.digest("hex")
}
```

**Why NOT full-file hash:**
- A 70 MB file takes 100–200 ms to hash fully on a typical laptop SSD. Catalog scans run on every import dialog open. Hashing all files on each scan would be unacceptably slow for users with 50+ sessions.
- Head + tail sampling is the standard approach used by deduplication systems (rsync, Perforce, many cloud storage checkers) to get high confidence at low cost.

**Why SHA-256 instead of xxHash or BLAKE3:**
- `crypto.createHash("sha256")` is built into Node.js — zero dependency, zero native compilation.
- For a deduplication use case (not cryptographic security), collision resistance of SHA-256 is far more than necessary. xxHash3 is 31 GB/s vs. SHA-256's ~0.5 GB/s, but hashing 8 KB takes microseconds at either speed; the I/O dominates.
- If profiling reveals SHA-256 is a bottleneck (unlikely), `Bun.hash` (xxHash3, sync, built-in to Bun) is the fast-path option — but again, only under Bun.

**What NOT to use:**

- Full-file SHA-256 on every catalog scan — O(total file bytes) per scan, unacceptable for 50+ large sessions.
- UUID-only deduplication — GUIDs from provider logs are not guaranteed stable across provider upgrades. Use them as a primary key but always back with content evidence.
- `@noble/hashes` or `blake3` npm packages — adds a dependency for marginal gain on an I/O-bound workload.

---

## 6. Large File Handling (70 MB+ JSONL Line-by-Line)

### Recommendation: Effect `FileSystem.stream` pipeline with bounded concurrency and back-pressure

**Confidence: HIGH**

This is covered by the pattern in section 1, but specific guidance for the 70 MB case:

**Memory budget:** A 70 MB file with 64 KB chunks allocates at most one chunk in flight (64 KB) plus the current parsed line (typically < 10 KB). Heap impact is negligible compared to the raw file size.

**Concurrency:** Use `Stream.mapEffect(..., { concurrency: 1 })` (the default) for sequential line processing. Parallel decoding is not needed for JSONL since lines are independent and the bottleneck is disk I/O, not CPU.

**Partial-failure tolerance:** Lines in JSONL files from live agents may occasionally be malformed (partial write on crash, encrypted reasoning fields in Codex). Use `Stream.catchAll` or `Stream.orElse` at the individual line level to skip bad lines and continue, not to abort the entire file:

```typescript
Stream.mapEffect((line) =>
  Effect.try({ try: () => JSON.parse(line), catch: (e) => new ParseError(e) })
).pipe(
  Stream.either,                                // never fail the stream on bad lines
  Stream.filterMap(Either.getRight),             // drop parse errors; log them separately
)
```

**Streaming vs. collecting:** Never collect the full stream into an array (`Stream.runCollect`) for 70 MB files. Use `Stream.runForEach` or `Stream.run(Sink.forEach(...))` to process each record and write to the XBE SQLite as it arrives. This keeps memory flat.

**Progress reporting:** Wrap the import loop in an `Effect.gen` that yields progress events to a `Queue` or `PubSub`; the WS server can push these to the browser. Do not buffer all events and report at the end.

**What NOT to use:**

- `JSON.parse(await fs.readFile(path, "utf8"))` — allocates the full 70 MB string plus the parsed object tree simultaneously.
- Worker threads for JSONL parsing — the CPU cost of `JSON.parse` on individual lines is trivial. Worker threads introduce IPC overhead and complexity without benefit.
- Any SAX-style streaming JSON parser (`stream-json`, `jsonstream`) — these are for parsing a single large JSON object whose interior exceeds memory. JSONL files are already line-delimited; a SAX parser is the wrong abstraction.

---

## 7. Effect-TS Integration Patterns for File I/O and Streaming

### Recommendation: Use `FileSystem.FileSystem` + `Path.Path` services; bridge node:sqlite via the existing `NodeSqliteClient`; use `Ndjson` from `effect/unstable/encoding` only for internal WS protocol, not file parsing

**Confidence: HIGH**

**7a. FileSystem service**

Always inject `FileSystem.FileSystem` via `yield*` rather than calling `node:fs` directly in Effect code. This enables testing with `FileSystem.layerNoop` mocks and keeps side effects inside Effect's supervision tree. See `apps/server/src/telemetry/Identify.ts` for the canonical example:

```typescript
const fs = yield* FileSystem.FileSystem
const content = yield* fs.readFileString(authJsonPath)
```

For streaming, `fs.stream(path, { chunkSize: FileSystem.KiB(64) })` returns `Stream<Uint8Array, PlatformError>` directly composable with `Stream.decodeText` and `Stream.splitLines`.

**7b. Path service**

Use `Path.Path` (`yield* Path.Path`) for all path construction rather than `node:path` directly. This is the Effect way to remain platform-neutral. See `Identify.ts`.

**7c. NodeSqliteClient**

The existing `NodeSqliteClient.layer(config)` and `NodeSqliteClient.layerConfig(config)` constructors create scoped Effect layers. For reading Codex SQLite, add a `readonly: true` option to the config and provide the layer in a tightly-scoped `Effect.provide` rather than the global server layer, since the Codex DB path is user-specific and not known at server startup.

**7d. Ndjson from `effect/unstable/encoding`**

The installed effect-smol build exposes `Ndjson` under `effect/unstable/encoding/Ndjson` (confirmed by inspecting `apps/server/node_modules/.bun/effect@.../dist/unstable/encoding/Ndjson.d.ts`). It provides `Channel`-based `decode`, `decodeSchema`, `decodeString`, `decodeSchemaString`, `encode`, `encodeSchema` constructors.

This module is used by the RPC layer for WebSocket protocol serialization (`RpcSerialization.layerNdjson`). It is the right tool for the WS streaming protocol.

However, for file-based import, prefer `Stream.splitLines` + per-line `JSON.parse` because:
- `Ndjson.decode` operates as a `Channel`, requiring additional plumbing to integrate with a `Stream<Uint8Array>` from `FileSystem.stream`.
- The `decodeSchema` variant validates every line against a Schema — useful for strict input validation, but adds overhead per line for the import path where a `Schema.decodeUnknownOption` per-line with fallback is more appropriate.
- If full Schema validation per line is desired, `Ndjson.decodeSchema` with an `Effect.orElse` skip strategy is a valid alternative to the manual split-parse approach.

**7e. Error handling**

Use `Schema.decodeUnknownEither` (not `decodeUnknownSync`) when processing individual JSONL lines from untrusted files. JSONL from Claude Code and Codex uses evolving schemas; unknown fields must be tolerated. Define schemas with `Schema.Struct` using `exactOptional: false` and `ignoreUnknownKeys: true` to be forward-compatible.

**7f. Scoped resource lifecycle**

The import operation involves opening potentially dozens of files and one SQLite database. Use `Effect.scoped` with `Stream.acquireRelease` or `Layer.scoped` to ensure all file handles and the SQLite connection are closed even on interrupt or error. The existing `NodeSqliteClient.ts` implementation already uses `Scope.addFinalizer` to close the database.

---

## Summary Table

| Concern | Recommendation | Dependency | Confidence |
|---------|---------------|------------|------------|
| JSONL streaming | `FileSystem.stream` + `Stream.decodeText` + `Stream.splitLines` + `JSON.parse` | Built-in (effect-smol) | HIGH |
| Bun fast-path JSONL | `Bun.JSONL.parseChunk` | Built-in (Bun only) | MEDIUM |
| SQLite read-only | `NodeSqliteClient.layer({ readonly: true })` + `PRAGMA busy_timeout` | Built-in (node:sqlite) | HIGH |
| FS scanning (targeted) | `FileSystem.readDirectory` + `FileSystem.stat` | Built-in (effect-smol) | HIGH |
| FS scanning (glob) | `tinyglobby` | New dep: `tinyglobby` | HIGH |
| Content fingerprinting | `crypto.createHash("sha256")` on head+tail sample | Built-in (node:crypto) | HIGH |
| Large file processing | `Stream.runForEach`, no `Stream.runCollect`, back-pressure by default | Built-in (effect-smol) | HIGH |
| Effect file I/O | `FileSystem.FileSystem` service + `Path.Path` service | Built-in (effect-smol) | HIGH |
| Schema validation | `Schema.decodeUnknownEither` per-line, tolerate unknown fields | Built-in (effect-smol) | HIGH |
| WS Ndjson protocol | `effect/unstable/encoding/Ndjson` (existing RPC usage) | Built-in (effect-smol) | HIGH |

---

## Version Pinning Notes

The monorepo pins `effect` to a private preview build at `pkg.pr.new/Effect-TS/effect-smol/effect@8881a9b`. This is an effect v4 pre-release. Module paths differ from stable effect v3:

- `effect/FileSystem` (v4) vs `@effect/platform/FileSystem` (v3)
- `effect/unstable/encoding/Ndjson` (v4, confirmed in installed source)
- `effect/unstable/sql/SqlClient` (v4, confirmed in `NodeSqliteClient.ts`)

Do not reference `@effect/platform` module paths for file system operations; use the `effect/` paths instead. The `@effect/platform-node` package is still used for the Node.js layer (`NodeFileSystem.layer`, `NodeContext.layer`) but the types live in `effect/`.
