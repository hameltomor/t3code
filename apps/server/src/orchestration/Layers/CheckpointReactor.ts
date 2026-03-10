import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
} from "@xbetools/contracts";
import { Cause, Effect, Layer, Option, Queue, Stream } from "effect";

import { parseTurnDiffFilesFromUnifiedDiff } from "../../checkpointing/Diffs.ts";
import {
  checkpointRefForThreadTurn,
  resolveCheckpointTargets,
} from "../../checkpointing/Utils.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { CheckpointReactor, type CheckpointReactorShape } from "../Services/CheckpointReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { CheckpointStoreError } from "../../checkpointing/Errors.ts";
import { OrchestrationDispatchError } from "../Errors.ts";
import { isGitRepository } from "../../git/isRepo.ts";

type ReactorInput =
  | {
      readonly source: "runtime";
      readonly event: ProviderRuntimeEvent;
    }
  | {
      readonly source: "domain";
      readonly event: OrchestrationEvent;
    };

function toTurnId(value: string | undefined): TurnId | null {
  return value === undefined ? null : TurnId.makeUnsafe(String(value));
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function checkpointStatusFromRuntime(status: string | undefined): "ready" | "missing" | "error" {
  switch (status) {
    case "failed":
      return "error";
    case "cancelled":
    case "interrupted":
      return "missing";
    case "completed":
    default:
      return "ready";
  }
}

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const checkpointStore = yield* CheckpointStore;

  const appendRevertFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnCount: number;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("checkpoint-revert-failure"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: "checkpoint.revert.failed",
        summary: "Checkpoint revert failed",
        payload: {
          turnCount: input.turnCount,
          detail: input.detail,
        },
        turnId: null,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const appendCaptureFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("checkpoint-capture-failure"),
      threadId: input.threadId,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "error",
        kind: "checkpoint.capture.failed",
        summary: "Checkpoint capture failed",
        payload: {
          detail: input.detail,
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const resolveSessionRuntimeForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<
    Option.Option<{ readonly threadId: ThreadId; readonly cwd: string }>
  > {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);

    const sessions = yield* providerService.listSessions();

    const findSessionWithCwd = (
      session: (typeof sessions)[number] | undefined,
    ): Option.Option<{ readonly threadId: ThreadId; readonly cwd: string }> => {
      if (!session?.cwd) {
        return Option.none();
      }
      return Option.some({ threadId: session.threadId!, cwd: session.cwd });
    };

    if (thread) {
      const projectedSession = sessions.find(
        (session) => session.threadId === thread.id,
      );
      const fromProjected = findSessionWithCwd(projectedSession);
      if (Option.isSome(fromProjected)) {
        return fromProjected;
      }
    }

    return Option.none();
  });

  const isGitWorkspace = (cwd: string) => isGitRepository(cwd);

  const captureCheckpointFromTurnCompletion = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === event.threadId);
    if (!thread) {
      return;
    }

    // When a primary turn is active, only that turn may produce completion checkpoints.
    if (thread.session?.activeTurnId && !sameId(thread.session.activeTurnId, turnId)) {
      return;
    }

    if (thread.checkpoints.some((checkpoint) => checkpoint.turnId === turnId && checkpoint.status !== "missing")) {
      return;
    }

    const checkpointTargets = resolveCheckpointTargets({
      thread,
      projects: readModel.projects,
    });
    if (checkpointTargets.length === 0) {
      // Fall back to session runtime CWD for single-repo cases.
      const sessionRuntime = yield* resolveSessionRuntimeForThread(thread.id);
      const sessionCwd = Option.match(sessionRuntime, {
        onNone: () => undefined,
        onSome: (runtime) => runtime.cwd,
      });
      if (sessionCwd && isGitWorkspace(sessionCwd)) {
        checkpointTargets.push({ cwd: sessionCwd, pathPrefix: "" });
      }
    }
    if (checkpointTargets.length === 0) {
      yield* Effect.logDebug("checkpoint capture skipped: no git repos found", {
        threadId: thread.id,
        turnId,
      });
      return;
    }

    const currentTurnCount = thread.checkpoints
      .filter((checkpoint) => checkpoint.status !== "missing")
      .reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);
    const nextTurnCount = currentTurnCount + 1;
    const fromTurnCount = Math.max(0, nextTurnCount - 1);
    const fromCheckpointRef = checkpointRefForThreadTurn(thread.id, fromTurnCount);
    const targetCheckpointRef = checkpointRefForThreadTurn(thread.id, nextTurnCount);

    // Capture checkpoint and compute diff for each repo target.
    type FileSummary = { path: string; kind: "modified"; additions: number; deletions: number };
    const allFiles: FileSummary[] = [];
    for (const target of checkpointTargets) {
      const fromExists = yield* checkpointStore.hasCheckpointRef({
        cwd: target.cwd,
        checkpointRef: fromCheckpointRef,
      });
      if (!fromExists) {
        yield* Effect.logWarning("checkpoint completion missing pre-turn baseline", {
          threadId: thread.id,
          turnId,
          fromTurnCount,
          cwd: target.cwd,
        });
      }

      yield* checkpointStore.captureCheckpoint({
        cwd: target.cwd,
        checkpointRef: targetCheckpointRef,
      });

      const repoFiles = yield* checkpointStore
        .diffCheckpoints({
          cwd: target.cwd,
          fromCheckpointRef,
          toCheckpointRef: targetCheckpointRef,
          fallbackFromToHead: false,
          pathPrefix: target.pathPrefix,
        })
        .pipe(
          Effect.map((diff) =>
            parseTurnDiffFilesFromUnifiedDiff(diff).map((file) => ({
              path: file.path,
              kind: "modified" as const,
              additions: file.additions,
              deletions: file.deletions,
            })),
          ),
          Effect.tapError((error) =>
            appendCaptureFailureActivity({
              threadId: thread.id,
              turnId,
              detail: `Checkpoint captured, but turn diff summary is unavailable: ${error.message}`,
              createdAt: event.createdAt,
            }),
          ),
          Effect.catch(() => Effect.succeed([] as FileSummary[])),
        );
      allFiles.push(...repoFiles);
    }
    if (allFiles.length === 0) {
      yield* Effect.logDebug("checkpoint captured but no file changes detected", {
        threadId: thread.id,
        turnId,
        turnCount: nextTurnCount,
      });
    }
    const files = allFiles;

    const assistantMessageId =
      thread.messages
        .toReversed()
        .find((entry) => entry.role === "assistant" && entry.turnId === turnId)?.id ??
      MessageId.makeUnsafe(`assistant:${turnId}`);

    const now = event.createdAt;
    yield* orchestrationEngine.dispatch({
      type: "thread.turn.diff.complete",
      commandId: serverCommandId("checkpoint-turn-diff-complete"),
      threadId: thread.id,
      turnId,
      completedAt: now,
      checkpointRef: targetCheckpointRef,
      status: checkpointStatusFromRuntime(event.payload.state),
      files,
      assistantMessageId,
      checkpointTurnCount: nextTurnCount,
      createdAt: now,
    });

    yield* orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("checkpoint-captured-activity"),
      threadId: thread.id,
      activity: {
        id: EventId.makeUnsafe(crypto.randomUUID()),
        tone: "info",
        kind: "checkpoint.captured",
        summary: "Checkpoint captured",
        payload: {
          turnCount: nextTurnCount,
          status: event.payload.state,
        },
        turnId,
        createdAt: now,
      },
      createdAt: now,
    });
  });

  const ensurePreTurnBaselineFromTurnStart = Effect.fnUntraced(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.started" }>,
  ) {
    const turnId = toTurnId(event.turnId);
    if (!turnId) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find(
      (entry) => entry.id === event.threadId,
    );
    if (!thread) {
      return;
    }

    const checkpointTargets = resolveCheckpointTargets({
      thread,
      projects: readModel.projects,
    });
    if (checkpointTargets.length === 0) {
      const sessionCwd = Option.match(yield* resolveSessionRuntimeForThread(thread.id), {
        onNone: () => undefined,
        onSome: (runtime) => runtime.cwd,
      });
      if (sessionCwd && isGitWorkspace(sessionCwd)) {
        checkpointTargets.push({ cwd: sessionCwd, pathPrefix: "" });
      }
    }
    if (checkpointTargets.length === 0) {
      return;
    }

    const currentTurnCount = thread.checkpoints
      .filter((checkpoint) => checkpoint.status !== "missing")
      .reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);
    const baselineCheckpointRef = checkpointRefForThreadTurn(thread.id, currentTurnCount);

    for (const target of checkpointTargets) {
      const baselineExists = yield* checkpointStore.hasCheckpointRef({
        cwd: target.cwd,
        checkpointRef: baselineCheckpointRef,
      });
      if (!baselineExists) {
        yield* checkpointStore.captureCheckpoint({
          cwd: target.cwd,
          checkpointRef: baselineCheckpointRef,
        });
      }
    }
  });

  const ensurePreTurnBaselineFromDomainTurnStart = Effect.fnUntraced(function* (
    event: Extract<
      OrchestrationEvent,
      { type: "thread.turn-start-requested" | "thread.message-sent" }
    >,
  ) {
    if (event.type === "thread.message-sent") {
      if (
        event.payload.role !== "user" ||
        event.payload.streaming ||
        event.payload.turnId !== null
      ) {
        return;
      }
    }

    const threadId = event.payload.threadId;
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return;
    }

    const checkpointTargets = resolveCheckpointTargets({
      thread,
      projects: readModel.projects,
    });
    if (checkpointTargets.length === 0) {
      const sessionCwd = Option.match(yield* resolveSessionRuntimeForThread(threadId), {
        onNone: () => undefined,
        onSome: (runtime) => runtime.cwd,
      });
      if (sessionCwd && isGitWorkspace(sessionCwd)) {
        checkpointTargets.push({ cwd: sessionCwd, pathPrefix: "" });
      }
    }
    if (checkpointTargets.length === 0) {
      return;
    }

    const currentTurnCount = thread.checkpoints
      .filter((checkpoint) => checkpoint.status !== "missing")
      .reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);
    const baselineCheckpointRef = checkpointRefForThreadTurn(threadId, currentTurnCount);

    for (const target of checkpointTargets) {
      const baselineExists = yield* checkpointStore.hasCheckpointRef({
        cwd: target.cwd,
        checkpointRef: baselineCheckpointRef,
      });
      if (!baselineExists) {
        yield* checkpointStore.captureCheckpoint({
          cwd: target.cwd,
          checkpointRef: baselineCheckpointRef,
        });
      }
    }
  });

  const handleRevertRequested = Effect.fnUntraced(function* (
    event: Extract<OrchestrationEvent, { type: "thread.checkpoint-revert-requested" }>,
  ) {
    const now = new Date().toISOString();

    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === event.payload.threadId);
    if (!thread) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: "Thread was not found in read model.",
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const revertTargets = resolveCheckpointTargets({
      thread,
      projects: readModel.projects,
    });
    if (revertTargets.length === 0) {
      // Fall back to session runtime CWD for single-repo.
      const sessionRuntime = yield* resolveSessionRuntimeForThread(event.payload.threadId);
      if (Option.isSome(sessionRuntime) && isGitWorkspace(sessionRuntime.value.cwd)) {
        revertTargets.push({ cwd: sessionRuntime.value.cwd, pathPrefix: "" });
      }
    }
    if (revertTargets.length === 0) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: "Checkpoints are unavailable because no git repositories were found.",
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const currentTurnCount = thread.checkpoints
      .filter((checkpoint) => checkpoint.status !== "missing")
      .reduce((maxTurnCount, checkpoint) => Math.max(maxTurnCount, checkpoint.checkpointTurnCount), 0);

    if (event.payload.turnCount > currentTurnCount) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Checkpoint turn count ${event.payload.turnCount} exceeds current turn count ${currentTurnCount}.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const targetCheckpointRef =
      event.payload.turnCount === 0
        ? checkpointRefForThreadTurn(event.payload.threadId, 0)
        : thread.checkpoints.find(
            (checkpoint) => checkpoint.checkpointTurnCount === event.payload.turnCount,
          )?.checkpointRef;

    if (!targetCheckpointRef) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Checkpoint ref for turn ${event.payload.turnCount} is unavailable in read model.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    let anyRestored = false;
    for (const target of revertTargets) {
      const restored = yield* checkpointStore.restoreCheckpoint({
        cwd: target.cwd,
        checkpointRef: targetCheckpointRef,
        fallbackToHead: event.payload.turnCount === 0,
      });
      if (restored) anyRestored = true;
    }
    if (!anyRestored) {
      yield* appendRevertFailureActivity({
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        detail: `Filesystem checkpoint is unavailable for turn ${event.payload.turnCount}.`,
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
      return;
    }

    const rolledBackTurns = Math.max(0, currentTurnCount - event.payload.turnCount);
    if (rolledBackTurns > 0) {
      const sessionRuntime = yield* resolveSessionRuntimeForThread(event.payload.threadId);
      if (Option.isSome(sessionRuntime)) {
        yield* providerService.rollbackConversation({
          threadId: sessionRuntime.value.threadId,
          numTurns: rolledBackTurns,
        });
      }
    }

    const staleCheckpointRefs = thread.checkpoints
      .filter((checkpoint) => checkpoint.checkpointTurnCount > event.payload.turnCount)
      .map((checkpoint) => checkpoint.checkpointRef);

    if (staleCheckpointRefs.length > 0) {
      for (const target of revertTargets) {
        yield* checkpointStore.deleteCheckpointRefs({
          cwd: target.cwd,
          checkpointRefs: staleCheckpointRefs,
        });
      }
    }

    yield* orchestrationEngine
      .dispatch({
        type: "thread.revert.complete",
        commandId: serverCommandId("checkpoint-revert-complete"),
        threadId: event.payload.threadId,
        turnCount: event.payload.turnCount,
        createdAt: now,
      })
      .pipe(
        Effect.catch((error) =>
          appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
            createdAt: now,
          }),
        ),
        Effect.asVoid,
      );
  });

  const processDomainEvent = Effect.fnUntraced(function* (event: OrchestrationEvent) {
    if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
      yield* ensurePreTurnBaselineFromDomainTurnStart(event);
      return;
    }

    if (event.type === "thread.checkpoint-revert-requested") {
      yield* handleRevertRequested(event).pipe(
        Effect.catch((error) =>
          appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
            createdAt: new Date().toISOString(),
          }),
        ),
      );
    }
  });

  const processRuntimeEvent = Effect.fnUntraced(function* (event: ProviderRuntimeEvent) {
    if (event.type === "turn.started") {
      yield* ensurePreTurnBaselineFromTurnStart(event);
      return;
    }

    if (event.type === "turn.completed") {
      const turnId = toTurnId(event.turnId);
      yield* captureCheckpointFromTurnCompletion(event).pipe(
        Effect.catch((error) =>
          appendCaptureFailureActivity({
            threadId: event.threadId,
            turnId,
            detail: error.message,
            createdAt: new Date().toISOString(),
          }).pipe(Effect.catch(() => Effect.void)),
        ),
      );
      return;
    }
  });

  const processInput = (
    input: ReactorInput,
  ): Effect.Effect<void, CheckpointStoreError | OrchestrationDispatchError, never> =>
    input.source === "domain" ? processDomainEvent(input.event) : processRuntimeEvent(input.event);

  const processInputSafely = (input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("checkpoint reactor failed to process input", {
          source: input.source,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const start: CheckpointReactorShape["start"] = Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ReactorInput>();
    yield* Effect.addFinalizer(() => Queue.shutdown(queue).pipe(Effect.asVoid));

    yield* Effect.forkScoped(
      Effect.forever(Queue.take(queue).pipe(Effect.flatMap(processInputSafely))),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.message-sent" &&
          event.type !== "thread.checkpoint-revert-requested"
        ) {
          return Effect.void;
        }
        return Queue.offer(queue, { source: "domain", event }).pipe(Effect.asVoid);
      }),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, (event) => {
        if (event.type !== "turn.started" && event.type !== "turn.completed") {
          return Effect.void;
        }
        return Queue.offer(queue, { source: "runtime", event }).pipe(Effect.asVoid);
      }),
    );
  });

  return {
    start,
  } satisfies CheckpointReactorShape;
});

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make);
