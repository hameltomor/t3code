/**
 * HistoryMaterializer layer implementation.
 *
 * Turns parsed Codex transcript data into XBE threads by dispatching
 * orchestration commands (thread.create, thread.message.import, thread.activity.import).
 *
 * Key design decisions:
 * - Uses thread.message.import (not thread.turn.start) to avoid triggering provider lifecycle
 * - Messages and activities dispatched sequentially to preserve ordering
 * - Deduplication via providerThreadId check on read model
 * - ThreadExternalLink persisted after successful import
 * - Partial import tracked on dispatch failure
 *
 * @module HistoryMaterializerLive
 */
import type { HistoryImportExecuteResult } from "@xbetools/contracts";
import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
} from "@xbetools/contracts";
import { Effect, Layer, Option, Schema } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ThreadExternalLinkRepository,
  type ThreadExternalLinkEntry,
} from "../../persistence/Services/ThreadExternalLinks.ts";
import { HistoryImportMaterializeError } from "../Errors.ts";
import {
  HistoryMaterializerService,
  type HistoryMaterializerShape,
} from "../Services/HistoryMaterializer.ts";

/** Safely decode a turnId string into a branded TurnId, returning null on invalid input */
function decodeTurnId(raw: string | null): typeof TurnId.Type | null {
  if (raw == null) return null;
  return Option.getOrNull(Schema.decodeUnknownOption(TurnId)(raw));
}

const makeHistoryMaterializer = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const externalLinkRepo = yield* ThreadExternalLinkRepository;

  const materialize: HistoryMaterializerShape["materialize"] = (input) =>
    Effect.gen(function* () {
      // ── 1. Deduplication check ─────────────────────────────────
      const readModel = yield* engine.getReadModel();
      const existingThread = readModel.threads.find(
        (t) => t.providerThreadId === input.providerThreadId && !t.deletedAt,
      );
      if (existingThread) {
        return yield* new HistoryImportMaterializeError({
          message: `Thread already imported: ${existingThread.id} (providerThreadId: ${input.providerThreadId})`,
          cause: { existingThreadId: existingThread.id, alreadyImported: true },
        });
      }

      // ── 2. Create thread via OrchestrationEngine ───────────────
      const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
      const now = new Date().toISOString();

      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe(`import:create:${crypto.randomUUID()}`),
        threadId,
        projectId: input.projectId as typeof import("@xbetools/contracts").ProjectId.Type,
        title: input.title as typeof import("@xbetools/contracts").TrimmedNonEmptyString.Type,
        model: input.model as typeof import("@xbetools/contracts").TrimmedNonEmptyString.Type,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        branch: null,
        worktreePath: null,
        providerThreadId: input.providerThreadId as typeof import("@xbetools/contracts").TrimmedNonEmptyString.Type,
        createdAt: now as typeof import("@xbetools/contracts").IsoDateTime.Type,
      });

      // ── 3. Dispatch messages sequentially ──────────────────────
      let messageCount = 0;
      for (const msg of input.messages) {
        const turnId = decodeTurnId(msg.turnId);
        yield* engine.dispatch({
          type: "thread.message.import",
          commandId: CommandId.makeUnsafe(`import:msg:${crypto.randomUUID()}`),
          threadId,
          messageId: MessageId.makeUnsafe(crypto.randomUUID()),
          role: msg.role,
          text: msg.text,
          turnId,
          streaming: false, // All imported messages are complete (force-completed in parser)
          createdAt: msg.createdAt as typeof import("@xbetools/contracts").IsoDateTime.Type,
        });
        messageCount++;
      }

      // ── 4. Dispatch activities sequentially ────────────────────
      let activityCount = 0;
      for (const activity of input.activities) {
        const turnId = decodeTurnId(activity.turnId);
        yield* engine.dispatch({
          type: "thread.activity.import",
          commandId: CommandId.makeUnsafe(`import:activity:${crypto.randomUUID()}`),
          threadId,
          activity: {
            id: EventId.makeUnsafe(crypto.randomUUID()),
            tone: activity.tone,
            kind: activity.kind as typeof import("@xbetools/contracts").TrimmedNonEmptyString.Type,
            summary: activity.summary as typeof import("@xbetools/contracts").TrimmedNonEmptyString.Type,
            payload: activity.payload,
            turnId,
            createdAt: activity.createdAt as typeof import("@xbetools/contracts").IsoDateTime.Type,
          },
          createdAt: activity.createdAt as typeof import("@xbetools/contracts").IsoDateTime.Type,
        });
        activityCount++;
      }

      // ── 5. Persist ThreadExternalLink ──────────────────────────
      yield* externalLinkRepo
        .upsert({
          threadId: threadId as string,
          providerName: input.providerName,
          linkMode: input.linkMode,
          providerConversationId: input.providerConversationId,
          providerSessionId: input.providerSessionId,
          resumeAnchorId: input.resumeAnchorId,
          sourcePath: input.sourcePath,
          sourceFingerprint: input.sourceFingerprint,
          originalWorkspaceRoot: input.originalWorkspaceRoot,
          originalCwd: input.originalCwd,
          validationStatus: "valid",
          rawResumeSeedJson: null,
          importedAt: now,
          lastValidatedAt: now,
        } satisfies ThreadExternalLinkEntry)
        .pipe(
          Effect.mapError(
            (cause) =>
              new HistoryImportMaterializeError({
                message: `Failed to persist ThreadExternalLink for thread ${threadId}`,
                cause,
              }),
          ),
        );

      // ── 6. Return result ───────────────────────────────────────
      return {
        threadId,
        messageCount,
        activityCount,
        linkMode: input.linkMode,
        importedAt: now,
      } as HistoryImportExecuteResult;
    }).pipe(
      Effect.withSpan("HistoryMaterializer.materialize"),
      Effect.mapError((error) =>
        "_tag" in error && error._tag === "HistoryImportMaterializeError"
          ? (error as HistoryImportMaterializeError)
          : new HistoryImportMaterializeError({
              message: `Materialization failed: ${String(error)}`,
              cause: error,
            }),
      ),
    );

  return { materialize } satisfies HistoryMaterializerShape;
});

export const HistoryMaterializerLive = Layer.effect(
  HistoryMaterializerService,
  makeHistoryMaterializer,
);
