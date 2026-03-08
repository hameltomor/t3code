/**
 * GeminiRuntimeEvents - Helpers for emitting canonical runtime events from the Gemini adapter.
 *
 * Maps Gemini tool calls to the same event shapes that Codex and Claude Code
 * adapters emit, so the existing UI renders tool work logs correctly.
 *
 * @module GeminiRuntimeEvents
 */
import {
  EventId,
  type ProviderRuntimeEvent,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
  type TurnId,
} from "@xbetools/contracts";
import { DateTime, Effect, Queue, Random } from "effect";

import {
  classifyToolItemType,
  classifyToolRequestType,
  summarizeToolCall,
  titleForToolItem,
} from "./GeminiToolDefinitions.ts";

const PROVIDER = "gemini" as const;

export interface GeminiEventEmitter {
  readonly emit: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly makeEventStamp: () => Effect.Effect<{ eventId: EventId; createdAt: string }>;
}

export function createEventEmitter(
  queue: Queue.Queue<ProviderRuntimeEvent>,
): GeminiEventEmitter {
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
  const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

  const emit = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Queue.offer(queue, event).pipe(Effect.asVoid);

  return { emit, makeEventStamp };
}

export function emitToolStarted(
  emitter: GeminiEventEmitter,
  opts: {
    threadId: ThreadId;
    turnId: TurnId;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stamp = yield* emitter.makeEventStamp();
    const itemType = classifyToolItemType(opts.toolName);
    yield* emitter.emit({
      type: "item.started",
      eventId: stamp.eventId,
      provider: PROVIDER,
      threadId: opts.threadId,
      createdAt: stamp.createdAt,
      turnId: opts.turnId,
      itemId: RuntimeItemId.makeUnsafe(opts.toolCallId),
      payload: {
        itemType,
        status: "inProgress",
        title: titleForToolItem(opts.toolName),
        detail: summarizeToolCall(opts.toolName, opts.args),
        data: { toolName: opts.toolName, input: opts.args },
      },
      raw: {
        source: "gemini.sdk.function-call",
        payload: { name: opts.toolName, args: opts.args, id: opts.toolCallId },
      },
    });
  });
}

export function emitToolCompleted(
  emitter: GeminiEventEmitter,
  opts: {
    threadId: ThreadId;
    turnId: TurnId;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
    status: "completed" | "failed" | "declined";
  },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stamp = yield* emitter.makeEventStamp();
    const itemType = classifyToolItemType(opts.toolName);
    yield* emitter.emit({
      type: "item.completed",
      eventId: stamp.eventId,
      provider: PROVIDER,
      threadId: opts.threadId,
      createdAt: stamp.createdAt,
      turnId: opts.turnId,
      itemId: RuntimeItemId.makeUnsafe(opts.toolCallId),
      payload: {
        itemType,
        status: opts.status,
        title: titleForToolItem(opts.toolName),
        detail: summarizeToolCall(opts.toolName, opts.args),
        data: { toolName: opts.toolName, input: opts.args, output: opts.result },
      },
    });
  });
}

export function emitCommandOutputDelta(
  emitter: GeminiEventEmitter,
  opts: {
    threadId: ThreadId;
    turnId: TurnId;
    toolCallId: string;
    delta: string;
  },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stamp = yield* emitter.makeEventStamp();
    yield* emitter.emit({
      type: "content.delta",
      eventId: stamp.eventId,
      provider: PROVIDER,
      threadId: opts.threadId,
      createdAt: stamp.createdAt,
      turnId: opts.turnId,
      itemId: RuntimeItemId.makeUnsafe(opts.toolCallId),
      payload: { streamKind: "command_output", delta: opts.delta },
    });
  });
}

export function emitApprovalRequested(
  emitter: GeminiEventEmitter,
  opts: {
    threadId: ThreadId;
    turnId: TurnId;
    requestId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stamp = yield* emitter.makeEventStamp();
    yield* emitter.emit({
      type: "request.opened",
      eventId: stamp.eventId,
      provider: PROVIDER,
      threadId: opts.threadId,
      createdAt: stamp.createdAt,
      turnId: opts.turnId,
      itemId: RuntimeItemId.makeUnsafe(opts.toolCallId),
      requestId: RuntimeRequestId.makeUnsafe(opts.requestId),
      payload: {
        requestType: classifyToolRequestType(opts.toolName),
        detail: summarizeToolCall(opts.toolName, opts.args),
        args: { toolName: opts.toolName, input: opts.args },
      },
    });
  });
}

export function emitApprovalResolved(
  emitter: GeminiEventEmitter,
  opts: {
    threadId: ThreadId;
    turnId: TurnId;
    requestId: string;
    toolCallId: string;
    toolName: string;
    decision: string;
  },
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const stamp = yield* emitter.makeEventStamp();
    yield* emitter.emit({
      type: "request.resolved",
      eventId: stamp.eventId,
      provider: PROVIDER,
      threadId: opts.threadId,
      createdAt: stamp.createdAt,
      turnId: opts.turnId,
      itemId: RuntimeItemId.makeUnsafe(opts.toolCallId),
      requestId: RuntimeRequestId.makeUnsafe(opts.requestId),
      payload: {
        requestType: classifyToolRequestType(opts.toolName),
        decision: opts.decision,
      },
    });
  });
}
