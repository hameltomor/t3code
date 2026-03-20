/**
 * GeminiCliRuntime - Gemini CLI wrapper for Track B (CLI transport).
 *
 * Spawns the Gemini CLI in headless mode with `-o stream-json` to get structured
 * NDJSON events. Maps CLI events into canonical ProviderRuntimeEvent types that
 * match the existing SDK adapter and Codex/Claude Code patterns.
 *
 * Limitations vs SDK transport:
 *   - Multi-turn continuity uses prompt-based transcript replay, not native
 *     session resume. Context is bounded and approximate.
 *   - readThread returns assistant-only text reconstructed from the local
 *     cliTurns log. Tool calls, attachments, and system messages are not
 *     available in CLI readback.
 *   - Attachments are not supported (rejected at preflight).
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
 * Returns undefined for unparseable, malformed, or unknown event types.
 *
 * Each event type is validated with strict type guards — no `as unknown as` casts.
 */
export function parseCliEvent(line: string): GeminiCliEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed.type || typeof parsed.type !== "string") return undefined;
    if (typeof parsed.timestamp !== "string") return undefined;

    switch (parsed.type) {
      case "init":
        return validateInitEvent(parsed);
      case "message":
        return validateMessageEvent(parsed);
      case "tool_use":
        return validateToolUseEvent(parsed);
      case "tool_result":
        return validateToolResultEvent(parsed);
      case "result":
        return validateResultEvent(parsed);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function validateInitEvent(p: Record<string, unknown>): GeminiCliInitEvent | undefined {
  if (typeof p.session_id !== "string" || typeof p.model !== "string") return undefined;
  return {
    type: "init",
    timestamp: p.timestamp as string,
    session_id: p.session_id,
    model: p.model,
  };
}

function validateMessageEvent(p: Record<string, unknown>): GeminiCliMessageEvent | undefined {
  if (typeof p.content !== "string") return undefined;
  if (p.role !== "user" && p.role !== "assistant") return undefined;
  return {
    type: "message",
    timestamp: p.timestamp as string,
    role: p.role,
    content: p.content,
    ...(typeof p.delta === "boolean" ? { delta: p.delta } : {}),
  };
}

function validateToolUseEvent(p: Record<string, unknown>): GeminiCliToolUseEvent | undefined {
  if (typeof p.tool_name !== "string" || typeof p.tool_id !== "string") return undefined;
  if (typeof p.parameters !== "object" || p.parameters === null || Array.isArray(p.parameters)) return undefined;
  return {
    type: "tool_use",
    timestamp: p.timestamp as string,
    tool_name: p.tool_name,
    tool_id: p.tool_id,
    parameters: p.parameters as Record<string, unknown>,
  };
}

function validateToolResultEvent(p: Record<string, unknown>): GeminiCliToolResultEvent | undefined {
  if (typeof p.tool_id !== "string" || typeof p.output !== "string") return undefined;
  if (p.status !== "success" && p.status !== "error") return undefined;
  return {
    type: "tool_result",
    timestamp: p.timestamp as string,
    tool_id: p.tool_id,
    status: p.status,
    output: p.output,
  };
}

function validateResultEvent(p: Record<string, unknown>): GeminiCliResultEvent | undefined {
  if (p.status !== "success" && p.status !== "error") return undefined;
  if (typeof p.stats === "object" && p.stats !== null && !Array.isArray(p.stats)) {
    return {
      type: "result",
      timestamp: p.timestamp as string,
      status: p.status,
      stats: p.stats as NonNullable<GeminiCliResultEvent["stats"]>,
    };
  }
  return {
    type: "result",
    timestamp: p.timestamp as string,
    status: p.status,
  };
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
 *
 * All returned objects satisfy the ProviderRuntimeEvent schema without unsafe casts.
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
          raw: {
            source: "gemini.cli.init",
            payload: { session_id: event.session_id, model: event.model },
          },
        } satisfies ProviderRuntimeEvent);
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
          } satisfies ProviderRuntimeEvent);
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
        } satisfies ProviderRuntimeEvent);
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
            itemType: "dynamic_tool_call",
            status: event.status === "success" ? "completed" : "failed",
            title: "Tool result",
            detail: truncate(event.output, 500),
            data: { output: event.output },
          },
          raw: {
            source: "gemini.cli.tool-result",
            payload: { tool_id: event.tool_id, status: event.status, output: event.output },
          },
        } satisfies ProviderRuntimeEvent);
        break;
      }

      case "result": {
        // NOTE: Do not emit turn.completed here. The adapter (GeminiAdapter)
        // is the sole authority for turn completion and emits it after the
        // CLI process exits. Emitting here would cause duplicate events.
        break;
      }
    }

    return events;
  });
}

// ── CLI Process Lifecycle ────────────────────────────────────────────

/** Serialized prior turn for CLI transcript replay. */
export interface CliTranscriptTurn {
  readonly userMessage: string;
  readonly assistantText: string;
}

export interface GeminiCliSessionOptions {
  readonly prompt: string;
  readonly cwd?: string | undefined;
  readonly model?: string | undefined;
  readonly runtimeMode: RuntimeMode;
  /** Resume a previous CLI session by index or "latest". */
  readonly resumeSession?: string | undefined;
  /** Prior turns for multi-turn continuity. Injected into the prompt prefix. */
  readonly priorTurns?: ReadonlyArray<CliTranscriptTurn> | undefined;
}

/**
 * Build a deterministic transcript prefix for multi-turn CLI continuity.
 *
 * Since the Gemini CLI does not support native session resume in headless mode,
 * we prepend a bounded transcript of prior turns to the new prompt. This gives
 * the model conversational context without claiming full session parity.
 *
 * Continuity strategy: prompt-based transcript replay (bounded, deterministic).
 *
 * Safety: Content is JSON-encoded per turn to prevent injection via user/assistant
 * text. Newest turns are preserved first under the character budget. Oversized
 * individual turns are skipped (not break-terminated) so smaller older turns
 * can still be included.
 */
export function buildTranscriptPrefix(
  priorTurns: ReadonlyArray<CliTranscriptTurn>,
): string {
  if (priorTurns.length === 0) return "";

  const MAX_TURNS = 10;
  const MAX_CHARS = 8_000;
  const recent = priorTurns.slice(-MAX_TURNS);

  // Build from newest to oldest so newest turns are preserved under char budget
  const selected: string[] = [];
  let charCount = 0;
  const HEADER = "--- prior conversation (JSONL, one object per turn) ---\n";
  const FOOTER = "--- end prior conversation ---\n\nContinuing from the conversation above:\n\n";
  const overhead = HEADER.length + FOOTER.length;
  charCount += overhead;

  for (let i = recent.length - 1; i >= 0; i--) {
    const entry = JSON.stringify({ role: "user", content: recent[i]!.userMessage }) + "\n" +
      JSON.stringify({ role: "assistant", content: recent[i]!.assistantText }) + "\n";
    if (charCount + entry.length > MAX_CHARS) continue;
    selected.unshift(entry);
    charCount += entry.length;
  }

  if (selected.length === 0) return "";

  return HEADER + selected.join("") + FOOTER;
}

/**
 * Build the command-line arguments for spawning `gemini` in headless mode.
 */
export function buildCliArgs(opts: GeminiCliSessionOptions): string[] {
  // If there are prior turns, prepend transcript context to the prompt
  const transcriptPrefix = opts.priorTurns ? buildTranscriptPrefix(opts.priorTurns) : "";
  const fullPrompt = transcriptPrefix + opts.prompt;

  const args: string[] = [
    "-p", fullPrompt,
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

/**
 * Classify a CLI tool name into a valid canonical item type.
 *
 * NOTE: `file_read_approval` is a request type, not an item type. Read/view
 * tools are classified as `dynamic_tool_call` which is the correct generic
 * canonical item type for tool invocations that don't fit a more specific bucket.
 */
function classifyCliToolItemType(
  toolName: string,
): "command_execution" | "file_change" | "dynamic_tool_call" {
  const lower = toolName.toLowerCase();
  if (lower.includes("command") || lower.includes("shell") || lower === "run_shell_command") {
    return "command_execution";
  }
  if (lower.includes("edit") || lower.includes("write") || lower.includes("patch") || lower.includes("replace")) {
    return "file_change";
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
