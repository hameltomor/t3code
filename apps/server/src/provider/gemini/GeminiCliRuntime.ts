/**
 * GeminiCliRuntime - Native Gemini CLI runtime wrapper for Track B.
 *
 * Spawns the Gemini CLI in headless mode with `-o stream-json` to get structured
 * NDJSON events. Maps CLI events into canonical ProviderRuntimeEvent types that
 * match the existing SDK adapter and Codex/Claude Code patterns.
 *
 * This module gives XBE true Gemini subscription parity: the CLI owns
 * login/subscription state, and XBE brokers the session — same as Codex and
 * Claude Code.
 *
 * CLI event types (stream-json):
 *   - init:        { type, timestamp, session_id, model }
 *   - message:     { type, timestamp, role, content, delta? }
 *   - tool_use:    { type, timestamp, tool_name, tool_id, parameters }
 *   - tool_result: { type, timestamp, tool_id, status, output }
 *   - result:      { type, timestamp, status, stats }
 *
 * @module GeminiCliRuntime
 */
import type {
  ProviderRuntimeEvent,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@xbetools/contracts";
import {
  EventId,
  RuntimeItemId,
} from "@xbetools/contracts";
import { DateTime, Effect, Random, Stream } from "effect";

const PROVIDER = "gemini" as const;

// ── CLI Event Types ──────────────────────────────────────────────────

export interface GeminiCliInitEvent {
  readonly type: "init";
  readonly timestamp: string;
  readonly session_id: string;
  readonly model: string;
}

export interface GeminiCliMessageEvent {
  readonly type: "message";
  readonly timestamp: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly delta?: boolean;
}

export interface GeminiCliToolUseEvent {
  readonly type: "tool_use";
  readonly timestamp: string;
  readonly tool_name: string;
  readonly tool_id: string;
  readonly parameters: Record<string, unknown>;
}

export interface GeminiCliToolResultEvent {
  readonly type: "tool_result";
  readonly timestamp: string;
  readonly tool_id: string;
  readonly status: "success" | "error";
  readonly output: string;
}

export interface GeminiCliResultEvent {
  readonly type: "result";
  readonly timestamp: string;
  readonly status: "success" | "error";
  readonly stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    duration_ms?: number;
    tool_calls?: number;
  };
}

export type GeminiCliEvent =
  | GeminiCliInitEvent
  | GeminiCliMessageEvent
  | GeminiCliToolUseEvent
  | GeminiCliToolResultEvent
  | GeminiCliResultEvent;

// ── CLI Event Parsing ────────────────────────────────────────────────

/**
 * Parse a single line of NDJSON from the Gemini CLI stream-json output.
 * Returns undefined for unparseable or unknown event types.
 */
export function parseCliEvent(line: string): GeminiCliEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed.type || typeof parsed.type !== "string") return undefined;

    switch (parsed.type) {
      case "init":
        return parsed as unknown as GeminiCliInitEvent;
      case "message":
        return parsed as unknown as GeminiCliMessageEvent;
      case "tool_use":
        return parsed as unknown as GeminiCliToolUseEvent;
      case "tool_result":
        return parsed as unknown as GeminiCliToolResultEvent;
      case "result":
        return parsed as unknown as GeminiCliResultEvent;
      default:
        // Unknown event type — skip gracefully
        return undefined;
    }
  } catch {
    return undefined;
  }
}

// ── CLI Event to Runtime Event Mapping ───────────────────────────────

interface EventStamp {
  readonly eventId: EventId;
  readonly createdAt: string;
}

function makeEventStamp(): Effect.Effect<EventStamp> {
  return Effect.all({
    eventId: Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id)),
    createdAt: Effect.map(DateTime.now, DateTime.formatIso),
  });
}

/**
 * Map a Gemini CLI event into zero or more canonical ProviderRuntimeEvents.
 * Returns an array since some CLI events may map to multiple provider events.
 */
export function mapCliEventToRuntimeEvents(
  event: GeminiCliEvent,
  context: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId;
  },
): Effect.Effect<ProviderRuntimeEvent[]> {
  return Effect.gen(function* () {
    const { threadId, turnId } = context;
    const events: ProviderRuntimeEvent[] = [];

    switch (event.type) {
      case "init": {
        const stamp = yield* makeEventStamp();
        events.push({
          type: "session.configured",
          eventId: stamp.eventId,
          provider: PROVIDER,
          threadId,
          createdAt: stamp.createdAt,
          turnId,
          payload: {
            config: {
              model: event.model,
              cliSessionId: event.session_id,
              transport: "cli",
            },
          },
        } as unknown as ProviderRuntimeEvent);
        break;
      }

      case "message": {
        if (event.role === "assistant" && event.delta) {
          const stamp = yield* makeEventStamp();
          events.push({
            type: "content.delta",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            turnId,
            itemId: RuntimeItemId.makeUnsafe(`cli-assistant-${turnId}`),
            payload: { streamKind: "assistant_text", delta: event.content },
          } as unknown as ProviderRuntimeEvent);
        }
        break;
      }

      case "tool_use": {
        const stamp = yield* makeEventStamp();
        events.push({
          type: "item.started",
          eventId: stamp.eventId,
          provider: PROVIDER,
          threadId,
          createdAt: stamp.createdAt,
          turnId,
          itemId: RuntimeItemId.makeUnsafe(event.tool_id),
          payload: {
            itemType: classifyCliToolItemType(event.tool_name),
            status: "inProgress",
            title: event.tool_name,
            detail: summarizeCliToolCall(event.tool_name, event.parameters),
            data: { toolName: event.tool_name, input: event.parameters },
          },
          raw: {
            source: "gemini.cli.tool-use",
            payload: { name: event.tool_name, parameters: event.parameters, id: event.tool_id },
          },
        } as unknown as ProviderRuntimeEvent);
        break;
      }

      case "tool_result": {
        const stamp = yield* makeEventStamp();
        events.push({
          type: "item.completed",
          eventId: stamp.eventId,
          provider: PROVIDER,
          threadId,
          createdAt: stamp.createdAt,
          turnId,
          itemId: RuntimeItemId.makeUnsafe(event.tool_id),
          payload: {
            itemType: "command_execution",
            status: event.status === "success" ? "completed" : "failed",
            title: `Tool result`,
            detail: truncate(event.output, 500),
            data: { output: event.output },
          },
        } as unknown as ProviderRuntimeEvent);
        break;
      }

      case "result": {
        const stamp = yield* makeEventStamp();
        events.push({
          type: "turn.completed",
          eventId: stamp.eventId,
          provider: PROVIDER,
          threadId,
          createdAt: stamp.createdAt,
          turnId,
          payload: {
            state: event.status === "success" ? "completed" : "failed",
          },
        } as unknown as ProviderRuntimeEvent);
        break;
      }
    }

    return events;
  });
}

// ── CLI Process Lifecycle ────────────────────────────────────────────

export interface GeminiCliSessionOptions {
  readonly prompt: string;
  readonly cwd?: string | undefined;
  readonly model?: string | undefined;
  readonly runtimeMode: RuntimeMode;
  /** Resume a previous CLI session by index or "latest". */
  readonly resumeSession?: string | undefined;
}

/**
 * Build the command-line arguments for spawning `gemini` in headless mode.
 */
export function buildCliArgs(opts: GeminiCliSessionOptions): string[] {
  const args: string[] = [
    "-p", opts.prompt,
    "-o", "stream-json",
  ];

  if (opts.model) {
    args.push("-m", opts.model);
  }

  // Map XBE runtime modes to Gemini approval modes
  switch (opts.runtimeMode) {
    case "full-access":
      args.push("--approval-mode", "yolo");
      break;
    case "approval-required":
      args.push("--approval-mode", "default");
      break;
  }

  if (opts.resumeSession) {
    args.push("--resume", opts.resumeSession);
  }

  return args;
}

/**
 * Parse NDJSON lines from a raw stdout stream into GeminiCliEvent objects.
 * Handles partial line buffering.
 */
export function parseNdjsonStream(
  raw: Stream.Stream<Uint8Array>,
): Stream.Stream<GeminiCliEvent> {
  const decoder = new TextDecoder();
  let buffer = "";

  return Stream.flatMap(raw, (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last partial line in the buffer
    buffer = lines.pop() ?? "";

    const events: GeminiCliEvent[] = [];
    for (const line of lines) {
      const event = parseCliEvent(line);
      if (event) events.push(event);
    }
    return Stream.fromIterable(events);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function classifyCliToolItemType(
  toolName: string,
): "command_execution" | "file_change" | "file_read_approval" | "dynamic_tool_call" {
  const lower = toolName.toLowerCase();
  if (lower.includes("command") || lower.includes("shell") || lower === "run_shell_command") {
    return "command_execution";
  }
  if (lower.includes("edit") || lower.includes("write") || lower.includes("patch") || lower.includes("replace")) {
    return "file_change";
  }
  if (lower.includes("read") || lower.includes("view")) {
    return "file_read_approval";
  }
  return "dynamic_tool_call";
}

function summarizeCliToolCall(toolName: string, params: Record<string, unknown>): string {
  if (toolName === "run_shell_command" && typeof params.command === "string") {
    return params.command.length > 120 ? params.command.slice(0, 117) + "..." : params.command;
  }
  if (typeof params.path === "string") {
    return params.path;
  }
  return toolName;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
