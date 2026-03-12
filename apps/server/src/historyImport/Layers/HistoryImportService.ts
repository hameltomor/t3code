/**
 * HistoryImportService layer implementation.
 *
 * Provides list, preview, and execute methods for the history import flow.
 * - list: triggers Codex scan and returns catalog entries
 * - preview: parses rollout file with caps and returns message/activity sample
 * - execute: imports a catalog entry into an XBE thread via HistoryMaterializer
 *
 * @module HistoryImportServiceLive
 */
import type {
  HistoryImportConversationPreview,
  HistoryImportConversationSummary,
  HistoryImportLinkMode,
  HistoryImportProvider,
} from "@xbetools/contracts";
import { Effect, Layer } from "effect";

import { HistoryImportCatalogRepository } from "../../persistence/Services/HistoryImportCatalog.ts";
import {
  HistoryImportNotFoundError,
  HistoryImportScanError,
} from "../Errors.ts";
import {
  CodexHistoryScannerService,
} from "../Services/CodexHistoryScanner.ts";
import {
  CodexRolloutParserService,
} from "../Services/CodexRolloutParser.ts";
import {
  HistoryMaterializerService,
} from "../Services/HistoryMaterializer.ts";
import {
  HistoryImportServiceService,
  type HistoryImportServiceShape,
} from "../Services/HistoryImportService.ts";

// ── Layer Implementation ──────────────────────────────────────────────

const makeHistoryImportService = Effect.gen(function* () {
  const scanner = yield* CodexHistoryScannerService;
  const parser = yield* CodexRolloutParserService;
  const catalogRepo = yield* HistoryImportCatalogRepository;
  const materializer = yield* HistoryMaterializerService;

  const list: HistoryImportServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const workspaceRoot = input.workspaceRoot;

      // If no provider filter, or filter is "codex", scan Codex
      if (!input.providerFilter || input.providerFilter === "codex") {
        yield* scanner.scan({ workspaceRoot }).pipe(
          Effect.catch((scanError: HistoryImportScanError) =>
            // NFR-4: One provider failing must not block results from others
            Effect.logWarning("Codex scan failed", { error: scanError.message }).pipe(
              Effect.as([] as const),
            ),
          ),
        );
      }

      // Future: scan Claude Code, Gemini here (guarded by providerFilter)

      // Return catalog entries from database
      const entries = yield* catalogRepo
        .listByWorkspace({
          workspaceRoot,
          providerName: input.providerFilter,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HistoryImportScanError({
                message: `Failed to read catalog entries`,
                cause,
              }),
          ),
        );

      // Cast is safe: catalog entries are written by our scan code and always contain valid data.
      // The HistoryImportCatalogEntry schema uses plain String/Number while
      // HistoryImportConversationSummary uses branded types (TrimmedNonEmptyString, NonNegativeInt).
      // Since our scan code guarantees non-empty strings and non-negative ints, the cast is sound.
      return entries as unknown as ReadonlyArray<HistoryImportConversationSummary>;
    }).pipe(Effect.withSpan("HistoryImportService.list"));

  const preview: HistoryImportServiceShape["preview"] = (input) =>
    Effect.gen(function* () {
      const maxMessages = input.maxMessages ?? 50;

      // Look up catalog entry by catalogId
      const catalogEntry = yield* catalogRepo
        .getByCatalogId({ catalogId: input.catalogId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HistoryImportNotFoundError({
                message: `Failed to query catalog for ${input.catalogId}`,
                cause,
              }),
          ),
        );

      if (!catalogEntry) {
        return yield* new HistoryImportNotFoundError({
          message: `Catalog entry not found: ${input.catalogId}`,
        });
      }

      // Parse the rollout file with caps
      const parseResult = yield* parser.parse(catalogEntry.sourcePath, {
        maxMessages,
        maxActivities: 20,
      });

      // Build preview response
      const result: HistoryImportConversationPreview = {
        catalogId: catalogEntry.catalogId,
        providerName: catalogEntry.providerName as HistoryImportProvider,
        title: catalogEntry.title || "Untitled",
        messages: parseResult.messages.map((m) => ({
          role: m.role,
          text: m.text,
          createdAt: m.createdAt,
        })),
        activities: parseResult.activities.slice(0, 20).map((a) => ({
          kind: a.kind,
          summary: a.summary,
        })),
        totalMessageCount: parseResult.messages.length as HistoryImportConversationPreview["totalMessageCount"],
        totalActivityCount: parseResult.activities.length as HistoryImportConversationPreview["totalActivityCount"],
        isTruncated: parseResult.messages.length >= maxMessages,
        linkMode: catalogEntry.linkMode as HistoryImportLinkMode,
        warnings: parseResult.warnings as HistoryImportConversationPreview["warnings"],
      } as HistoryImportConversationPreview;

      return result;
    }).pipe(Effect.withSpan("HistoryImportService.preview"));

  const execute: HistoryImportServiceShape["execute"] = (input) =>
    Effect.gen(function* () {
      // Look up catalog entry
      const catalogEntry = yield* catalogRepo
        .getByCatalogId({ catalogId: input.catalogId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HistoryImportNotFoundError({
                message: `Failed to query catalog for ${input.catalogId}`,
                cause,
              }),
          ),
        );

      if (!catalogEntry) {
        return yield* new HistoryImportNotFoundError({
          message: `Catalog entry not found: ${input.catalogId}`,
        });
      }

      // Full parse (no caps) for import
      const parseResult = yield* parser.parse(catalogEntry.sourcePath);

      // Materialize into XBE thread
      const result = yield* materializer.materialize({
        projectId: input.projectId,
        title: input.title,
        model: input.model,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        linkMode: input.linkMode,
        providerThreadId: `codex:${catalogEntry.providerSessionId}`,
        providerName: catalogEntry.providerName as "codex",
        messages: parseResult.messages,
        activities: parseResult.activities,
        sourcePath: catalogEntry.sourcePath,
        sourceFingerprint: catalogEntry.fingerprint,
        originalWorkspaceRoot: catalogEntry.workspaceRoot,
        originalCwd: catalogEntry.cwd,
        providerConversationId: catalogEntry.providerConversationId,
        providerSessionId: catalogEntry.providerSessionId,
        resumeAnchorId: catalogEntry.resumeAnchorId,
      });

      return result;
    }).pipe(Effect.withSpan("HistoryImportService.execute"));

  return { list, preview, execute } satisfies HistoryImportServiceShape;
});

export const HistoryImportServiceLive = Layer.effect(
  HistoryImportServiceService,
  makeHistoryImportService,
);
