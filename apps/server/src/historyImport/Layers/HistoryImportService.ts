/**
 * HistoryImportService layer implementation.
 *
 * Provides list, preview, and execute methods for the history import flow.
 * - list: triggers Codex and Claude Code scans and returns catalog entries
 * - preview: routes to correct parser based on providerName (Codex or Claude Code)
 * - execute: imports a catalog entry into an XBE thread via HistoryMaterializer
 *
 * @module HistoryImportServiceLive
 */
import { stat } from "node:fs/promises";

import type {
  HistoryImportConversationPreview,
  HistoryImportConversationSummary,
  HistoryImportLinkMode,
  HistoryImportProvider,
  HistoryImportValidateLinkResult,
} from "@xbetools/contracts";
import { type IsoDateTime } from "@xbetools/contracts";
import { Effect, Layer, Option } from "effect";

import { HistoryImportCatalogRepository } from "../../persistence/Services/HistoryImportCatalog.ts";
import { ThreadExternalLinkRepository } from "../../persistence/Services/ThreadExternalLinks.ts";
import {
  HistoryImportNotFoundError,
  HistoryImportScanError,
} from "../Errors.ts";
import { computeFingerprint } from "../fingerprint.ts";
import {
  ClaudeCodeHistoryScannerService,
} from "../Services/ClaudeCodeHistoryScanner.ts";
import {
  ClaudeCodeSessionParserService,
} from "../Services/ClaudeCodeSessionParser.ts";
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

// ── Parse Result Normalization ───────────────────────────────────────

/** Normalized parse result shape for preview/execute routing */
interface NormalizedParseResult {
  readonly messages: ReadonlyArray<{
    readonly role: string;
    readonly text: string;
    readonly createdAt: string;
    readonly turnId: string | null;
    readonly isStreaming: boolean;
  }>;
  readonly activities: ReadonlyArray<{
    readonly kind: string;
    readonly summary: string;
    readonly tone: "info" | "tool" | "approval" | "error";
    readonly turnId: string | null;
    readonly createdAt: string;
    readonly payload: unknown;
  }>;
  readonly warnings: ReadonlyArray<string>;
  readonly sessionId: string | null;
  readonly lastAssistantUuid: string | null;
  readonly totalMessageCount: number;
  readonly totalActivityCount: number;
}

// ── Layer Implementation ──────────────────────────────────────────────

const makeHistoryImportService = Effect.gen(function* () {
  const codexScanner = yield* CodexHistoryScannerService;
  const codexParser = yield* CodexRolloutParserService;
  const claudeCodeScanner = yield* ClaudeCodeHistoryScannerService;
  const claudeCodeParser = yield* ClaudeCodeSessionParserService;
  const catalogRepo = yield* HistoryImportCatalogRepository;
  const materializer = yield* HistoryMaterializerService;
  const externalLinkRepo = yield* ThreadExternalLinkRepository;

  const list: HistoryImportServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const startTime = performance.now();
      const workspaceRoot = input.workspaceRoot;

      // If no provider filter, or filter is "codex", scan Codex
      if (!input.providerFilter || input.providerFilter === "codex") {
        yield* codexScanner.scan({ workspaceRoot }).pipe(
          Effect.catch((scanError: HistoryImportScanError) =>
            // NFR-4: One provider failing must not block results from others
            Effect.logWarning("Codex scan failed", { error: scanError.message }).pipe(
              Effect.as([] as const),
            ),
          ),
        );
      }

      // If no provider filter, or filter is "claudeCode", scan Claude Code
      if (!input.providerFilter || input.providerFilter === "claudeCode") {
        yield* claudeCodeScanner.scan({ workspaceRoot }).pipe(
          Effect.catch((scanError: HistoryImportScanError) =>
            // NFR-4: One provider failing must not block results from others
            Effect.logWarning("Claude Code scan failed", { error: scanError.message }).pipe(
              Effect.as([] as const),
            ),
          ),
        );
      }

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
      const elapsed = performance.now() - startTime;
      yield* Effect.logInfo(`HistoryImportService.list completed in ${elapsed.toFixed(0)}ms`);
      return entries as unknown as ReadonlyArray<HistoryImportConversationSummary>;
    }).pipe(Effect.withSpan("HistoryImportService.list"));

  const preview: HistoryImportServiceShape["preview"] = (input) =>
    Effect.gen(function* () {
      const startTime = performance.now();
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

      // Route to correct parser based on providerName
      let parseResult: NormalizedParseResult;

      if (catalogEntry.providerName === "claudeCode") {
        const ccResult = yield* claudeCodeParser.parse(catalogEntry.sourcePath, {
          maxMessages,
          maxActivities: 20,
        });
        parseResult = {
          messages: ccResult.messages,
          activities: ccResult.activities,
          warnings: ccResult.warnings,
          sessionId: ccResult.sessionId,
          lastAssistantUuid: ccResult.lastAssistantUuid,
          totalMessageCount: ccResult.totalMessageCount,
          totalActivityCount: ccResult.totalActivityCount,
        };
      } else {
        // Default: Codex parser
        const codexResult = yield* codexParser.parse(catalogEntry.sourcePath, {
          maxMessages,
          maxActivities: 20,
        });
        parseResult = {
          messages: codexResult.messages,
          activities: codexResult.activities,
          warnings: codexResult.warnings,
          sessionId: codexResult.sessionId,
          lastAssistantUuid: null,
          totalMessageCount: codexResult.totalMessageCount,
          totalActivityCount: codexResult.totalActivityCount,
        };
      }

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
        totalMessageCount: parseResult.totalMessageCount as HistoryImportConversationPreview["totalMessageCount"],
        totalActivityCount: parseResult.totalActivityCount as HistoryImportConversationPreview["totalActivityCount"],
        isTruncated:
          parseResult.totalMessageCount > parseResult.messages.length ||
          parseResult.totalActivityCount > parseResult.activities.length,
        linkMode: catalogEntry.linkMode as HistoryImportLinkMode,
        warnings: parseResult.warnings as HistoryImportConversationPreview["warnings"],
      } as HistoryImportConversationPreview;

      const elapsed = performance.now() - startTime;
      yield* Effect.logInfo(`HistoryImportService.preview completed in ${elapsed.toFixed(0)}ms`);
      return result;
    }).pipe(Effect.withSpan("HistoryImportService.preview"));

  const execute: HistoryImportServiceShape["execute"] = (input) =>
    Effect.gen(function* () {
      const startTime = performance.now();
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

      // Route to correct parser and build materializer input based on providerName
      if (catalogEntry.providerName === "claudeCode") {
        // Full parse with Claude Code parser
        const ccResult = yield* claudeCodeParser.parse(catalogEntry.sourcePath);

        // Materialize into XBE thread
        const result = yield* materializer.materialize({
          projectId: input.projectId,
          title: input.title,
          model: input.model,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          linkMode: input.linkMode,
          providerThreadId: `claudeCode:${catalogEntry.providerSessionId}`,
          providerName: "claudeCode",
          messages: ccResult.messages,
          activities: ccResult.activities,
          sourcePath: catalogEntry.sourcePath,
          sourceFingerprint: catalogEntry.fingerprint,
          originalWorkspaceRoot: catalogEntry.workspaceRoot,
          originalCwd: catalogEntry.cwd,
          providerConversationId: catalogEntry.providerConversationId,
          providerSessionId: catalogEntry.providerSessionId,
          resumeAnchorId: ccResult.lastAssistantUuid,
        });

        const elapsed = performance.now() - startTime;
        yield* Effect.logInfo(`HistoryImportService.execute completed in ${elapsed.toFixed(0)}ms`);
        return result;
      }

      // Default: Codex flow
      const parseResult = yield* codexParser.parse(catalogEntry.sourcePath);

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

      const elapsed = performance.now() - startTime;
      yield* Effect.logInfo(`HistoryImportService.execute completed in ${elapsed.toFixed(0)}ms`);
      return result;
    }).pipe(Effect.withSpan("HistoryImportService.execute"));

  const validateLink: HistoryImportServiceShape["validateLink"] = (input) =>
    Effect.gen(function* () {
      const startTime = performance.now();
      const now = new Date().toISOString() as typeof IsoDateTime.Type;

      // Look up external link for thread
      const maybeLink = yield* externalLinkRepo
        .getByThreadId({ threadId: input.threadId as string })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HistoryImportNotFoundError({
                message: `Failed to query external link for thread ${input.threadId}`,
                cause,
              }),
          ),
        );

      if (Option.isNone(maybeLink)) {
        return yield* new HistoryImportNotFoundError({
          message: `No external link found for thread ${input.threadId}`,
        });
      }

      const link = maybeLink.value;

      // Check file existence
      const fileExistsResult = yield* Effect.tryPromise({
        try: () =>
          stat(link.sourcePath).then(
            () => true,
            () => false,
          ),
        catch: () => false as const,
      }).pipe(Effect.catch(() => Effect.succeed(false)));

      if (!fileExistsResult) {
        // File missing: upsert updated status
        yield* externalLinkRepo
          .upsert({ ...link, validationStatus: "missing", lastValidatedAt: now })
          .pipe(
            Effect.mapError(
              (cause) =>
                new HistoryImportNotFoundError({
                  message: `Failed to update external link for thread ${input.threadId}`,
                  cause,
                }),
            ),
          );

        const elapsed = performance.now() - startTime;
        yield* Effect.logInfo(`HistoryImportService.validateLink completed in ${elapsed.toFixed(0)}ms`);
        return {
          threadId: input.threadId,
          validationStatus: "missing",
          lastValidatedAt: now,
        } as HistoryImportValidateLinkResult;
      }

      // Recompute fingerprint
      const newFingerprint = yield* computeFingerprint(
        link.providerSessionId ?? (link.threadId as string),
        link.sourcePath,
      ).pipe(Effect.catch(() => Effect.succeed(null as string | null)));

      // Determine validation status
      let validationStatus: string;
      if (newFingerprint === null) {
        validationStatus = "invalid";
      } else if (newFingerprint === link.sourceFingerprint) {
        validationStatus = "valid";
      } else {
        validationStatus = "stale";
      }

      // Upsert updated link
      yield* externalLinkRepo
        .upsert({ ...link, validationStatus, lastValidatedAt: now })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HistoryImportNotFoundError({
                message: `Failed to update external link for thread ${input.threadId}`,
                cause,
              }),
          ),
        );

      const elapsed = performance.now() - startTime;
      yield* Effect.logInfo(`HistoryImportService.validateLink completed in ${elapsed.toFixed(0)}ms`);
      return {
        threadId: input.threadId,
        validationStatus,
        lastValidatedAt: now,
      } as HistoryImportValidateLinkResult;
    }).pipe(Effect.withSpan("HistoryImportService.validateLink"));

  return { list, preview, execute, validateLink } satisfies HistoryImportServiceShape;
});

export const HistoryImportServiceLive = Layer.effect(
  HistoryImportServiceService,
  makeHistoryImportService,
);
