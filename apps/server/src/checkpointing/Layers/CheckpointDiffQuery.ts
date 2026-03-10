import {
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from "@xbetools/contracts";
import { Effect, Layer, Schema } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import { checkpointRefForThreadTurn, resolveCheckpointTargets } from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore;

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = (input) =>
    Effect.gen(function* () {
      const operation = "CheckpointDiffQuery.getTurnDiff";

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const thread = snapshot.threads.find((entry) => entry.id === input.threadId);
      if (!thread) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      const maxTurnCount = thread.checkpoints
        .filter((checkpoint) => checkpoint.status !== "missing")
        .reduce((max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount), 0);
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const checkpointTargets = resolveCheckpointTargets({
        thread,
        projects: snapshot.projects,
      });
      if (checkpointTargets.length === 0) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `No git repositories found for thread '${input.threadId}' when computing turn diff.`,
        });
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForThreadTurn(input.threadId, 0)
          : thread.checkpoints
              .filter((checkpoint) => checkpoint.status !== "missing")
              .find(
                (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
              )?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      const toCheckpointRef = thread.checkpoints
        .filter((checkpoint) => checkpoint.status !== "missing")
        .find(
          (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
        )?.checkpointRef;
      if (!toCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      // Compute diff across all repo targets, skipping repos where refs are missing.
      const patches: string[] = [];
      for (const target of checkpointTargets) {
        const [fromExists, toExists] = yield* Effect.all(
          [
            checkpointStore.hasCheckpointRef({
              cwd: target.cwd,
              checkpointRef: fromCheckpointRef,
            }),
            checkpointStore.hasCheckpointRef({
              cwd: target.cwd,
              checkpointRef: toCheckpointRef,
            }),
          ],
          { concurrency: "unbounded" },
        );
        if (!fromExists || !toExists) continue;

        const repoDiff = yield* checkpointStore.diffCheckpoints({
          cwd: target.cwd,
          fromCheckpointRef,
          toCheckpointRef,
          fallbackFromToHead: false,
          pathPrefix: target.pathPrefix,
        });
        if (repoDiff.trim().length > 0) {
          patches.push(repoDiff);
        }
      }

      if (patches.length === 0) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Filesystem checkpoints are unavailable for the requested turn range.`,
        });
      }

      const diff = patches.join("\n");

      const turnDiff: OrchestrationGetTurnDiffResultType = {
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff,
      };
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    });

  const getFullThreadDiff: CheckpointDiffQueryShape["getFullThreadDiff"] = (
    input: OrchestrationGetFullThreadDiffInput,
  ) =>
    getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
    }).pipe(Effect.map((result): OrchestrationGetFullThreadDiffResult => result));

  return {
    getTurnDiff,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);
