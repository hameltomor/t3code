/**
 * CodexHistoryScanner layer implementation.
 *
 * Discovers Codex sessions from state_5.sqlite and rollout files,
 * computes fingerprints, and upserts results into the history import catalog.
 *
 * @module CodexHistoryScannerLive
 */
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { glob } from "tinyglobby";

import type { HistoryImportCatalogEntry } from "../../persistence/Services/HistoryImportCatalog.ts";
import { HistoryImportCatalogRepository } from "../../persistence/Services/HistoryImportCatalog.ts";
import { HistoryImportScanError } from "../Errors.ts";
import { computeFingerprint } from "../fingerprint.ts";
import {
  CodexHistoryScannerService,
  type CodexHistoryScannerShape,
} from "../Services/CodexHistoryScanner.ts";

// ── SQLite Row Type ─────────────────────────────────────────────────

interface CodexThreadRow {
  readonly id: string;
  readonly rollout_path: string | null;
  readonly cwd: string | null;
  readonly title: string | null;
  readonly model_provider: string | null;
  readonly created_at: number; // epoch seconds
  readonly updated_at: number; // epoch seconds
  readonly source: string | null;
  readonly first_user_message: string | null;
  readonly tokens_used: number | null;
  readonly agent_nickname: string | null;
  readonly cli_version: string | null;
}

// ── File existence check ────────────────────────────────────────────

function fileExists(filePath: string): Effect.Effect<boolean> {
  return Effect.tryPromise({
    try: () =>
      stat(filePath).then(
        () => true,
        () => false,
      ),
    catch: () => new HistoryImportScanError({ message: `Failed to stat ${filePath}` }),
  }).pipe(Effect.catch(() => Effect.succeed(false)));
}

// ── Rollout File Resolution ─────────────────────────────────────────

function resolveRolloutFile(
  threadId: string,
  rolloutPath: string | null,
  codexHome: string,
): Effect.Effect<string | null, HistoryImportScanError> {
  return Effect.gen(function* () {
    // Try the explicit rollout_path first
    if (rolloutPath) {
      const exists = yield* fileExists(rolloutPath);
      if (exists) return rolloutPath;
    }

    // Fall back to globbing for the thread ID in session files
    const matches = yield* Effect.tryPromise({
      try: () => glob(["sessions/**/*.jsonl"], { cwd: codexHome, absolute: true }),
      catch: (cause) =>
        new HistoryImportScanError({
          message: `Failed to glob rollout files in ${codexHome}`,
          cause,
        }),
    });

    const match = matches.find((m) => m.includes(threadId));
    return match ?? null;
  });
}

// ── Codex Home Resolution ───────────────────────────────────────────

function resolveCodexHome(override?: string): string {
  if (override) return override;
  if (process.env.CODEX_SQLITE_HOME) return process.env.CODEX_SQLITE_HOME;
  return path.join(os.homedir(), ".codex");
}

// ── Scoped Codex SQLite Layer ───────────────────────────────────────

type SqliteLoader = {
  layer: (config: { readonly filename: string; readonly readonly?: boolean }) => Layer.Layer<SqlClient.SqlClient>;
};

const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient") as Promise<SqliteLoader>,
  node: () => import("../../persistence/NodeSqliteClient.ts") as Promise<SqliteLoader>,
} satisfies Record<string, () => Promise<SqliteLoader>>;

/**
 * Creates a scoped read-only SQLite layer for the Codex database.
 * Uses runtime detection (bun vs node) consistent with the rest of the app.
 */
function loadCodexSqliteLayer(
  codexHome: string,
): Effect.Effect<Layer.Layer<SqlClient.SqlClient>, HistoryImportScanError> {
  const filename = path.join(codexHome, "state_5.sqlite");
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  return Effect.tryPromise({
    try: async () => {
      const mod = await loader();
      return mod.layer({ filename, readonly: true });
    },
    catch: (cause) =>
      new HistoryImportScanError({
        message: `Failed to create SQLite client for Codex database at ${filename}`,
        cause,
      }),
  });
}

// ── Epoch to ISO ────────────────────────────────────────────────────

function epochSecondsToIso(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

// ── Layer Implementation ────────────────────────────────────────────

const makeCodexHistoryScanner = Effect.gen(function* () {
  const catalogRepo = yield* HistoryImportCatalogRepository;

  const scan: CodexHistoryScannerShape["scan"] = (input) =>
    Effect.gen(function* () {
      const codexHome = resolveCodexHome(input.codexHome);
      const dbPath = path.join(codexHome, "state_5.sqlite");

      // Check if state_5.sqlite exists; if not, return empty (user may not have Codex)
      const dbExists = yield* fileExists(dbPath);
      if (!dbExists) {
        return [] as ReadonlyArray<HistoryImportCatalogEntry>;
      }

      // Load the scoped read-only SQLite layer for the Codex database
      const codexSqlLayer = yield* loadCodexSqliteLayer(codexHome);

      // Set busy_timeout and query threads inside the scoped layer
      const queryThreads = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`PRAGMA busy_timeout = 5000`;

        const rows = yield* sql<CodexThreadRow>`
          SELECT id, rollout_path, cwd, title, model_provider, created_at, updated_at,
                 source, first_user_message, tokens_used, agent_nickname, cli_version
          FROM threads
          WHERE (cwd = ${input.workspaceRoot} OR cwd LIKE ${input.workspaceRoot + "/%"})
            AND source IN ('cli', 'vscode')
            AND agent_nickname IS NULL
            AND archived = 0
          ORDER BY updated_at DESC
        `;

        return rows;
      });

      const threadRows = yield* queryThreads.pipe(
        Effect.provide(codexSqlLayer),
        Effect.mapError(
          (cause) =>
            new HistoryImportScanError({
              message: `Failed to query Codex state_5.sqlite`,
              cause,
            }),
        ),
      );

      // Process each thread row
      const now = new Date().toISOString();
      const entries: HistoryImportCatalogEntry[] = [];

      for (const row of threadRows) {
        const rolloutFile = yield* resolveRolloutFile(
          row.id,
          row.rollout_path,
          codexHome,
        ).pipe(
          Effect.catch((err: HistoryImportScanError) => {
            return Effect.logWarning(
              `Skipping rollout resolution for thread ${row.id}: ${err.message}`,
            ).pipe(Effect.map(() => null as string | null));
          }),
        );

        if (!rolloutFile) continue;

        const fingerprint = yield* computeFingerprint(row.id, rolloutFile).pipe(
          Effect.catch((err: HistoryImportScanError) => {
            return Effect.logWarning(
              `Skipping fingerprint for thread ${row.id}: ${err.message}`,
            ).pipe(Effect.map(() => null as string | null));
          }),
        );

        if (!fingerprint) continue;

        const entry: HistoryImportCatalogEntry = {
          catalogId: `codex:${row.id}`,
          providerName: "codex",
          workspaceRoot: input.workspaceRoot,
          cwd: row.cwd ?? input.workspaceRoot,
          title: row.title || row.first_user_message || "Untitled Codex Session",
          model: row.model_provider ?? null,
          messageCount: 0,
          turnCount: 0,
          providerConversationId: row.id,
          providerSessionId: row.id,
          resumeAnchorId: row.id,
          sourceKind: "codex-rollout",
          sourcePath: rolloutFile,
          linkMode: "native-resume",
          validationStatus: "valid",
          warningsJson: "[]",
          fingerprint,
          rawMetadataJson: JSON.stringify({
            source: row.source,
            tokens_used: row.tokens_used,
            cli_version: row.cli_version,
          }),
          createdAt: epochSecondsToIso(row.created_at),
          updatedAt: epochSecondsToIso(row.updated_at),
          lastScannedAt: now,
        };

        yield* catalogRepo.upsert(entry).pipe(
          Effect.mapError(
            (cause) =>
              new HistoryImportScanError({
                message: `Failed to upsert catalog entry for codex:${row.id}`,
                cause,
              }),
          ),
        );

        entries.push(entry);
      }

      return entries as ReadonlyArray<HistoryImportCatalogEntry>;
    }).pipe(Effect.withSpan("CodexHistoryScanner.scan"));

  return { scan } satisfies CodexHistoryScannerShape;
});

export const CodexHistoryScannerLive = Layer.effect(
  CodexHistoryScannerService,
  makeCodexHistoryScanner,
);
