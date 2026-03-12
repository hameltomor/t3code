/**
 * ClaudeCodeHistoryScanner layer implementation.
 *
 * Discovers Claude Code sessions from ~/.claude/projects/<encoded-path>/,
 * using sessions-index.json when available with JSONL header fallback.
 * Computes fingerprints and upserts results into the history import catalog.
 *
 * @module ClaudeCodeHistoryScannerLive
 */
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { Effect, Layer, Option, Schema } from "effect";

import type { HistoryImportCatalogEntry } from "../../persistence/Services/HistoryImportCatalog.ts";
import { HistoryImportCatalogRepository } from "../../persistence/Services/HistoryImportCatalog.ts";
import { HistoryImportScanError } from "../Errors.ts";
import { computeFingerprint } from "../fingerprint.ts";
import {
  ClaudeCodeSessionsIndex,
  forwardEncodeClaudeCodePath,
} from "../Schemas/ClaudeCodeSessionSchemas.ts";
import {
  ClaudeCodeHistoryScannerService,
  type ClaudeCodeHistoryScannerShape,
} from "../Services/ClaudeCodeHistoryScanner.ts";

// ── File helpers ────────────────────────────────────────────────────

function dirExists(dirPath: string): Effect.Effect<boolean> {
  return Effect.tryPromise({
    try: () =>
      stat(dirPath).then(
        (s) => s.isDirectory(),
        () => false,
      ),
    catch: () => new HistoryImportScanError({ message: `Failed to stat ${dirPath}` }),
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

function fileExists(filePath: string): Effect.Effect<boolean> {
  return Effect.tryPromise({
    try: () =>
      stat(filePath).then(
        (s) => s.isFile(),
        () => false,
      ),
    catch: () => new HistoryImportScanError({ message: `Failed to stat ${filePath}` }),
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

function getFileMtime(filePath: string): Effect.Effect<Date, HistoryImportScanError> {
  return Effect.tryPromise({
    try: async () => {
      const s = await stat(filePath);
      return s.mtime;
    },
    catch: (cause) =>
      new HistoryImportScanError({
        message: `Failed to stat ${filePath}`,
        cause,
      }),
  });
}

// ── JSONL Header Extraction ─────────────────────────────────────────

interface JnlHeaderMeta {
  sessionId: string | null;
  cwd: string | null;
  timestamp: string | null;
  version: string | null;
  gitBranch: string | null;
  firstUserMessage: string | null;
}

/**
 * Read the first few lines of a JSONL file to extract session metadata.
 * Uses readline for efficient partial reading without loading the full file.
 */
function extractHeaderMetadata(
  filePath: string,
  maxLines: number = 10,
): Effect.Effect<JnlHeaderMeta, HistoryImportScanError> {
  return Effect.tryPromise({
    try: () =>
      new Promise<JnlHeaderMeta>((resolve, reject) => {
        const meta: JnlHeaderMeta = {
          sessionId: null,
          cwd: null,
          timestamp: null,
          version: null,
          gitBranch: null,
          firstUserMessage: null,
        };

        let linesRead = 0;
        const stream = createReadStream(filePath, { encoding: "utf-8" });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });

        rl.on("line", (line) => {
          linesRead++;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;

            // Extract common fields from any line that has them
            if (!meta.sessionId && typeof parsed.sessionId === "string") {
              meta.sessionId = parsed.sessionId;
            }
            if (!meta.cwd && typeof parsed.cwd === "string") {
              meta.cwd = parsed.cwd;
            }
            if (!meta.timestamp && typeof parsed.timestamp === "string") {
              meta.timestamp = parsed.timestamp;
            }
            if (!meta.version && typeof parsed.version === "string") {
              meta.version = parsed.version;
            }
            if (!meta.gitBranch && typeof parsed.gitBranch === "string") {
              meta.gitBranch = parsed.gitBranch;
            }

            // Extract first user message text for title
            if (
              !meta.firstUserMessage &&
              parsed.type === "user" &&
              parsed.isMeta !== true &&
              parsed.isSidechain !== true
            ) {
              const message = parsed.message as { content?: unknown } | undefined;
              if (message?.content) {
                if (typeof message.content === "string") {
                  meta.firstUserMessage = message.content;
                } else if (Array.isArray(message.content)) {
                  const textBlock = (message.content as Array<{ type?: string; text?: string }>).find(
                    (b) => b.type === "text" && b.text,
                  );
                  if (textBlock?.text) {
                    meta.firstUserMessage = textBlock.text;
                  }
                }
              }
            }
          } catch {
            // Skip malformed lines
          }

          if (linesRead >= maxLines) {
            rl.close();
            stream.destroy();
          }
        });

        rl.on("close", () => resolve(meta));
        rl.on("error", reject);
        stream.on("error", reject);
      }),
    catch: (cause) =>
      new HistoryImportScanError({
        message: `Failed to read JSONL header from ${filePath}`,
        cause,
      }),
  });
}

// ── Layer Implementation ────────────────────────────────────────────

const makeClaudeCodeHistoryScanner = Effect.gen(function* () {
  const catalogRepo = yield* HistoryImportCatalogRepository;

  const scan: ClaudeCodeHistoryScannerShape["scan"] = (input) =>
    Effect.gen(function* () {
      const claudeHome = input.claudeHome ?? path.join(os.homedir(), ".claude");
      const projectsDir = path.join(claudeHome, "projects");

      // Check if projects directory exists
      const exists = yield* dirExists(projectsDir);
      if (!exists) {
        return [] as ReadonlyArray<HistoryImportCatalogEntry>;
      }

      // Forward-encode workspace path for directory matching
      const encoded = forwardEncodeClaudeCodePath(input.workspaceRoot);

      // Find matching project directories
      const dirEntries = yield* Effect.tryPromise({
        try: () => readdir(projectsDir, { withFileTypes: true }),
        catch: (cause) =>
          new HistoryImportScanError({
            message: `Failed to read projects directory ${projectsDir}`,
            cause,
          }),
      });

      const matchingDirs = dirEntries
        .filter((e) => e.isDirectory())
        .filter((e) => e.name === encoded || e.name.startsWith(encoded + "-"))
        .map((e) => path.join(projectsDir, e.name));

      if (matchingDirs.length === 0) {
        return [] as ReadonlyArray<HistoryImportCatalogEntry>;
      }

      const now = new Date().toISOString();
      const entries: HistoryImportCatalogEntry[] = [];

      for (const projectDir of matchingDirs) {
        // Try sessions-index.json first
        const indexPath = path.join(projectDir, "sessions-index.json");
        const hasIndex = yield* fileExists(indexPath);

        // Track session IDs from index to detect orphans
        const indexedSessionIds = new Set<string>();

        if (hasIndex) {
          // Parse sessions-index.json
          const indexRaw = yield* Effect.tryPromise({
            try: () => readFile(indexPath, "utf-8"),
            catch: (cause) =>
              new HistoryImportScanError({
                message: `Failed to read ${indexPath}`,
                cause,
              }),
          });

          const indexParsed: unknown = yield* Effect.try({
            try: () => JSON.parse(indexRaw) as unknown,
            catch: () =>
              new HistoryImportScanError({
                message: `Malformed JSON in ${indexPath}`,
              }),
          }).pipe(
            Effect.catch(() => Effect.succeed(null)),
          );

          if (indexParsed !== null) {
            const indexDecoded = Schema.decodeUnknownOption(ClaudeCodeSessionsIndex)(indexParsed);

            if (Option.isSome(indexDecoded)) {
              const index = indexDecoded.value;

              // Process non-sidechain entries from the index
              for (const indexEntry of index.entries) {
                if (indexEntry.isSidechain) continue;

                indexedSessionIds.add(indexEntry.sessionId);

                // Verify the JSONL file actually exists
                const jsonlPath = indexEntry.fullPath;
                const jsonlExists = yield* fileExists(jsonlPath);
                if (!jsonlExists) continue;

                const fingerprint = yield* computeFingerprint(indexEntry.sessionId, jsonlPath).pipe(
                  Effect.catch((err: HistoryImportScanError) =>
                    Effect.logWarning(
                      `Skipping fingerprint for session ${indexEntry.sessionId}: ${err.message}`,
                    ).pipe(Effect.map(() => null as string | null)),
                  ),
                );
                if (!fingerprint) continue;

                const entry: HistoryImportCatalogEntry = {
                  catalogId: `claudeCode:${indexEntry.sessionId}`,
                  providerName: "claudeCode",
                  workspaceRoot: indexEntry.projectPath || input.workspaceRoot,
                  cwd: indexEntry.projectPath || input.workspaceRoot,
                  title:
                    indexEntry.summary ||
                    (indexEntry.firstPrompt
                      ? indexEntry.firstPrompt.slice(0, 100)
                      : "Untitled Claude Code Session"),
                  model: null,
                  messageCount: indexEntry.messageCount,
                  turnCount: 0,
                  providerConversationId: indexEntry.sessionId,
                  providerSessionId: indexEntry.sessionId,
                  resumeAnchorId: null,
                  sourceKind: "claude-code-jsonl",
                  sourcePath: jsonlPath,
                  linkMode: "native-resume",
                  validationStatus: "valid",
                  warningsJson: "[]",
                  fingerprint,
                  rawMetadataJson: JSON.stringify({
                    gitBranch: indexEntry.gitBranch || undefined,
                  }),
                  createdAt: indexEntry.created,
                  updatedAt: indexEntry.modified,
                  lastScannedAt: now,
                };

                yield* catalogRepo.upsert(entry).pipe(
                  Effect.mapError(
                    (cause) =>
                      new HistoryImportScanError({
                        message: `Failed to upsert catalog entry for claudeCode:${indexEntry.sessionId}`,
                        cause,
                      }),
                  ),
                );

                entries.push(entry);
              }
            }
          }
        }

        // Scan for JSONL files (orphans if index existed, all if no index)
        const dirFiles = yield* Effect.tryPromise({
          try: () => readdir(projectDir),
          catch: (cause) =>
            new HistoryImportScanError({
              message: `Failed to read directory ${projectDir}`,
              cause,
            }),
        });

        const jsonlFiles = dirFiles.filter((f) => f.endsWith(".jsonl"));

        for (const jsonlFile of jsonlFiles) {
          // Extract session ID from filename (filename is <sessionId>.jsonl)
          const sessionId = jsonlFile.replace(/\.jsonl$/, "");

          // Skip if already processed from index
          if (indexedSessionIds.has(sessionId)) continue;

          const jsonlPath = path.join(projectDir, jsonlFile);

          // Extract metadata from JSONL header
          const headerMeta = yield* extractHeaderMetadata(jsonlPath).pipe(
            Effect.catch((err: HistoryImportScanError) =>
              Effect.logWarning(
                `Skipping header extraction for ${jsonlPath}: ${err.message}`,
              ).pipe(
                Effect.map(
                  () =>
                    ({
                      sessionId: null,
                      cwd: null,
                      timestamp: null,
                      version: null,
                      gitBranch: null,
                      firstUserMessage: null,
                    }) as JnlHeaderMeta,
                ),
              ),
            ),
          );

          const effectiveSessionId = headerMeta.sessionId || sessionId;

          const fingerprint = yield* computeFingerprint(effectiveSessionId, jsonlPath).pipe(
            Effect.catch((err: HistoryImportScanError) =>
              Effect.logWarning(
                `Skipping fingerprint for session ${effectiveSessionId}: ${err.message}`,
              ).pipe(Effect.map(() => null as string | null)),
            ),
          );
          if (!fingerprint) continue;

          const fileMtime = yield* getFileMtime(jsonlPath).pipe(
            Effect.catch(() => Effect.succeed(new Date())),
          );

          const entry: HistoryImportCatalogEntry = {
            catalogId: `claudeCode:${effectiveSessionId}`,
            providerName: "claudeCode",
            workspaceRoot: headerMeta.cwd || input.workspaceRoot,
            cwd: headerMeta.cwd || input.workspaceRoot,
            title: headerMeta.firstUserMessage
              ? headerMeta.firstUserMessage.slice(0, 100)
              : "Untitled Claude Code Session",
            model: null,
            messageCount: 0,
            turnCount: 0,
            providerConversationId: effectiveSessionId,
            providerSessionId: effectiveSessionId,
            resumeAnchorId: null,
            sourceKind: "claude-code-jsonl",
            sourcePath: jsonlPath,
            linkMode: "native-resume",
            validationStatus: "valid",
            warningsJson: "[]",
            fingerprint,
            rawMetadataJson: JSON.stringify({
              gitBranch: headerMeta.gitBranch || undefined,
              version: headerMeta.version || undefined,
            }),
            createdAt: headerMeta.timestamp || fileMtime.toISOString(),
            updatedAt: fileMtime.toISOString(),
            lastScannedAt: now,
          };

          yield* catalogRepo.upsert(entry).pipe(
            Effect.mapError(
              (cause) =>
                new HistoryImportScanError({
                  message: `Failed to upsert catalog entry for claudeCode:${effectiveSessionId}`,
                  cause,
                }),
            ),
          );

          entries.push(entry);
        }
      }

      return entries as ReadonlyArray<HistoryImportCatalogEntry>;
    }).pipe(Effect.withSpan("ClaudeCodeHistoryScanner.scan"));

  return { scan } satisfies ClaudeCodeHistoryScannerShape;
});

export const ClaudeCodeHistoryScannerLive = Layer.effect(
  ClaudeCodeHistoryScannerService,
  makeClaudeCodeHistoryScanner,
);
