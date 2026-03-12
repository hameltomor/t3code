/**
 * CodexRolloutParser layer implementation.
 *
 * Streams Codex JSONL rollout files line-by-line (NFR-1: no full-file loading),
 * handles compaction resets (Pitfall 1), encrypted reasoning (Pitfall 4),
 * and force-completes interrupted messages (Pitfall 8).
 *
 * @module CodexRolloutParserLive
 */
import { Effect, FileSystem, Layer, Option, Schema, Stream } from "effect";

import { HistoryImportParseError } from "../Errors.ts";
import {
  CodexCompactedItem,
  CodexEventMsg,
  CodexRolloutLine,
  CodexResponseItem,
  CodexSessionMetaLine,
  CodexTurnContext,
  isSubAgentSession,
  type CodexResponseItem as CodexResponseItemType,
} from "../Schemas/CodexRolloutSchemas.ts";
import {
  CodexRolloutParserService,
  type CodexRolloutParserShape,
  type CodexRolloutParseResult,
  type ParsedCodexActivity,
  type ParsedCodexMessage,
} from "../Services/CodexRolloutParser.ts";

// ── Parser State ──────────────────────────────────────────────────────

interface ParserState {
  sessionId: string | null;
  sessionMeta: CodexRolloutParseResult["sessionMeta"];
  messages: ParsedCodexMessage[];
  activities: ParsedCodexActivity[];
  warnings: string[];
  currentTurnId: string | null;
  linesProcessed: number;
  compactionCount: number;
  messageCapped: boolean;
  activityCapped: boolean;
  maxMessages: number;
  maxActivities: number;
}

function makeInitialState(maxMessages: number, maxActivities: number): ParserState {
  return {
    sessionId: null,
    sessionMeta: null,
    messages: [],
    activities: [],
    warnings: [],
    currentTurnId: null,
    linesProcessed: 0,
    compactionCount: 0,
    messageCapped: false,
    activityCapped: false,
    maxMessages,
    maxActivities,
  };
}

// ── Text Extraction ───────────────────────────────────────────────────

function extractTextFromContent(
  content: ReadonlyArray<{ readonly type: string; readonly text?: string | undefined }> | undefined,
  textType: string,
): string | null {
  if (!content || content.length === 0) return null;
  const parts = content.filter((c) => c.type === textType && c.text).map((c) => c.text!);
  return parts.length > 0 ? parts.join("\n") : null;
}

// ── Helper: Push message with cap check ──────────────────────────────

function pushMessage(state: ParserState, msg: ParsedCodexMessage): void {
  if (state.messageCapped) return;
  state.messages.push(msg);
  if (state.messages.length >= state.maxMessages) {
    state.messageCapped = true;
  }
}

function pushActivity(state: ParserState, act: ParsedCodexActivity): void {
  if (state.activityCapped) return;
  state.activities.push(act);
  if (state.activities.length >= state.maxActivities) {
    state.activityCapped = true;
  }
}

// ── Response Item Processing ──────────────────────────────────────────

function processResponseItem(
  state: ParserState,
  item: CodexResponseItemType,
  timestamp: string,
): void {
  // Message: user
  if (item.type === "message" && item.role === "user") {
    const text = extractTextFromContent(item.content, "input_text");
    if (text) {
      pushMessage(state, {
        role: "user",
        text,
        createdAt: timestamp,
        turnId: state.currentTurnId,
        isStreaming: false,
      });
    }
    return;
  }

  // Message: assistant
  if (item.type === "message" && item.role === "assistant") {
    const text = extractTextFromContent(item.content, "output_text");
    if (text) {
      pushMessage(state, {
        role: "assistant",
        text,
        createdAt: timestamp,
        turnId: state.currentTurnId,
        isStreaming: false,
      });
    }
    return;
  }

  // Reasoning
  if (item.type === "reasoning") {
    // Pitfall 4: Skip encrypted reasoning entirely
    if (item.encrypted_content) {
      state.warnings.push("Skipped encrypted reasoning");
      return;
    }
    // Extract reasoning summary if available
    if (item.summary && item.summary.length > 0) {
      const summaryText = item.summary
        .filter((c) => c.text)
        .map((c) => c.text!)
        .join("\n");
      if (summaryText) {
        pushActivity(state, {
          kind: "reasoning",
          summary: summaryText,
          tone: "info",
          turnId: state.currentTurnId,
          createdAt: timestamp,
          payload: null,
        });
      }
    }
    return;
  }

  // Tool calls: local_shell_call, function_call
  if (item.type === "local_shell_call" || item.type === "function_call") {
    pushActivity(state, {
      kind: item.type,
      summary: item.type,
      tone: "tool",
      turnId: state.currentTurnId,
      createdAt: timestamp,
      payload: item,
    });
    return;
  }

  // Function call output
  if (item.type === "function_call_output") {
    pushActivity(state, {
      kind: "function_call_output",
      summary: "function_call_output",
      tone: "tool",
      turnId: state.currentTurnId,
      createdAt: timestamp,
      payload: item,
    });
    return;
  }

  // Unknown item type: skip silently (schema tolerance)
}

// ── Compaction Handling (Pitfall 1) ───────────────────────────────────

function handleCompaction(
  state: ParserState,
  message: string,
  replacementHistory: ReadonlyArray<CodexResponseItemType> | undefined,
  timestamp: string,
): void {
  // DISCARD all accumulated messages and activities (compaction reset)
  state.messages = [];
  state.activities = [];
  state.messageCapped = false;
  state.activityCapped = false;
  state.compactionCount++;

  if (replacementHistory && replacementHistory.length > 0) {
    // Process replacement_history as if they were individual response_item lines
    for (const item of replacementHistory) {
      processResponseItem(state, item, timestamp);
    }
  } else {
    // No replacement_history: create synthetic system message
    pushMessage(state, {
      role: "system",
      text: `[Context compacted] ${message}`,
      createdAt: timestamp,
      turnId: state.currentTurnId,
      isStreaming: false,
    });
  }

  state.warnings.push("Context compaction detected -- pre-compaction messages discarded");
}

// ── Event Message Processing ──────────────────────────────────────────

function processEventMsg(
  state: ParserState,
  event: typeof CodexEventMsg.Type,
  timestamp: string,
): void {
  switch (event.type) {
    case "user_message": {
      if (event.message) {
        pushMessage(state, {
          role: "user",
          text: event.message,
          createdAt: timestamp,
          turnId: state.currentTurnId,
          isStreaming: false,
        });
      }
      break;
    }

    case "agent_message": {
      if (event.message) {
        pushMessage(state, {
          role: "assistant",
          text: event.message,
          createdAt: timestamp,
          turnId: state.currentTurnId,
          isStreaming: false,
        });
      }
      break;
    }

    case "task_started":
    case "turn_started": {
      if (event.turn_id) {
        state.currentTurnId = event.turn_id;
      }
      break;
    }

    case "task_complete":
    case "turn_complete": {
      pushActivity(state, {
        kind: "turn_complete",
        summary: event.type,
        tone: "info",
        turnId: state.currentTurnId,
        createdAt: timestamp,
        payload: event.info ?? null,
      });
      break;
    }

    case "exec_command_begin": {
      const summary = event.command
        ? `exec: ${event.command}${event.cwd ? ` (cwd: ${event.cwd})` : ""}`
        : "exec_command";
      pushActivity(state, {
        kind: "exec_command",
        summary,
        tone: "tool",
        turnId: state.currentTurnId,
        createdAt: timestamp,
        payload: { command: event.command, cwd: event.cwd },
      });
      break;
    }

    case "exec_command_end": {
      pushActivity(state, {
        kind: "exec_command_end",
        summary: `exec_command_end (exit: ${event.exit_code ?? "unknown"})`,
        tone: event.exit_code === 0 ? "info" : "error",
        turnId: state.currentTurnId,
        createdAt: timestamp,
        payload: { exit_code: event.exit_code },
      });
      break;
    }

    case "exec_approval_request":
    case "apply_patch_approval_request": {
      pushActivity(state, {
        kind: "approval_request",
        summary: event.type,
        tone: "approval",
        turnId: state.currentTurnId,
        createdAt: timestamp,
        payload: event,
      });
      break;
    }

    case "error": {
      pushActivity(state, {
        kind: "error",
        summary: event.message ?? "Unknown error",
        tone: "error",
        turnId: state.currentTurnId,
        createdAt: timestamp,
        payload: event,
      });
      break;
    }

    case "context_compacted": {
      // Treat same as "compacted" rollout line -- reset messages/activities
      handleCompaction(state, event.message ?? "Context compacted", undefined, timestamp);
      break;
    }

    default:
      // Unknown event type: skip silently (schema tolerance)
      break;
  }
}

// ── Line Processing ───────────────────────────────────────────────────

function processLine(state: ParserState, line: string, lineNumber: number): void {
  state.linesProcessed++;

  // Try to parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    state.warnings.push(`Malformed JSON at line ${lineNumber} (skipped)`);
    return;
  }

  // Validate against CodexRolloutLine schema
  const decoded = Schema.decodeUnknownOption(CodexRolloutLine)(parsed);
  if (Option.isNone(decoded)) {
    state.warnings.push(`Invalid rollout line schema at line ${lineNumber} (skipped)`);
    return;
  }

  const rolloutLine = decoded.value;
  const timestamp = rolloutLine.timestamp ?? new Date().toISOString();

  switch (rolloutLine.type) {
    case "session_meta": {
      // Re-decode the full line with the typed session_meta payload
      const metaDecoded = Schema.decodeUnknownOption(CodexSessionMetaLine)(parsed);
      if (Option.isSome(metaDecoded)) {
        const meta = metaDecoded.value.payload.meta;
        state.sessionId = meta.id;
        state.sessionMeta = {
          cwd: meta.cwd ?? null,
          model: meta.model_provider ?? null,
          source: meta.source,
          cliVersion: meta.cli_version ?? null,
          gitBranch: metaDecoded.value.payload.git?.branch ?? null,
          gitCommit: metaDecoded.value.payload.git?.commit_hash ?? null,
        };

        // Defense in depth: warn on sub-agent sessions
        if (isSubAgentSession(meta)) {
          state.warnings.push(`Sub-agent session detected (id: ${meta.id})`);
        }
      }
      break;
    }

    case "response_item": {
      const itemDecoded = Schema.decodeUnknownOption(CodexResponseItem)(rolloutLine.payload);
      if (Option.isSome(itemDecoded)) {
        processResponseItem(state, itemDecoded.value, timestamp);
      }
      break;
    }

    case "compacted": {
      // Pitfall 1: compaction reset
      const compactedDecoded = Schema.decodeUnknownOption(CodexCompactedItem)(rolloutLine.payload);
      if (Option.isSome(compactedDecoded)) {
        const compacted = compactedDecoded.value;
        handleCompaction(
          state,
          compacted.message,
          compacted.replacement_history,
          timestamp,
        );
      }
      break;
    }

    case "turn_context": {
      const turnDecoded = Schema.decodeUnknownOption(CodexTurnContext)(rolloutLine.payload);
      if (Option.isSome(turnDecoded)) {
        if (turnDecoded.value.turn_id) {
          state.currentTurnId = turnDecoded.value.turn_id;
        }
      }
      break;
    }

    case "event_msg": {
      const eventDecoded = Schema.decodeUnknownOption(CodexEventMsg)(rolloutLine.payload);
      if (Option.isSome(eventDecoded)) {
        processEventMsg(state, eventDecoded.value, timestamp);
      }
      break;
    }

    default:
      // Unknown line type: skip silently (schema tolerance)
      break;
  }
}

// ── Post-Processing ───────────────────────────────────────────────────

/**
 * Pitfall 8: Force-complete streaming messages.
 * After all lines are processed, any last assistant message is
 * guaranteed complete since we're reading a finished file (imports are always complete).
 */
function postProcess(state: ParserState): void {
  const { messages } = state;
  if (messages.length > 0) {
    const last = messages[messages.length - 1]!;
    if (last.role === "assistant" && last.isStreaming) {
      // Force-complete: imports are always complete
      messages[messages.length - 1] = { ...last, isStreaming: false };
    }
  }
}

// ── Layer Implementation ──────────────────────────────────────────────

/**
 * Layer construction acquires FileSystem at build time so the parse method
 * does not leak FileSystem into its return type.
 */
const makeCodexRolloutParser = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  /**
   * Stream lines from a JSONL file using Effect FileSystem.
   * Never loads the full file into memory (NFR-1).
   */
  const streamLines = (filePath: string) =>
    fs.stream(filePath, { chunkSize: FileSystem.KiB(64) }).pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.filter((line) => line.trim().length > 0),
    );

  const parse: CodexRolloutParserShape["parse"] = (filePath, options) =>
    Effect.gen(function* () {
      const maxMessages = options?.maxMessages ?? Number.MAX_SAFE_INTEGER;
      const maxActivities = options?.maxActivities ?? Number.MAX_SAFE_INTEGER;

      const state = makeInitialState(maxMessages, maxActivities);

      // Stream and fold over all lines, tracking line number via mutable state
      yield* Stream.runFold(
        streamLines(filePath),
        () => 0,
        (lineNumber, line: string) => {
          const nextLineNumber = lineNumber + 1;
          processLine(state, line, nextLineNumber);
          return nextLineNumber;
        },
      );

      // Post-processing: force-complete streaming messages
      postProcess(state);

      const result: CodexRolloutParseResult = {
        sessionId: state.sessionId,
        sessionMeta: state.sessionMeta,
        messages: state.messages,
        activities: state.activities,
        warnings: state.warnings,
        totalLinesProcessed: state.linesProcessed,
        compactionCount: state.compactionCount,
      };

      return result;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HistoryImportParseError({
            message: `Failed to parse rollout file: ${filePath}`,
            cause,
          }),
      ),
      Effect.withSpan("CodexRolloutParser.parse"),
    );

  return { parse } satisfies CodexRolloutParserShape;
});

export const CodexRolloutParserLive = Layer.effect(
  CodexRolloutParserService,
  makeCodexRolloutParser,
);
