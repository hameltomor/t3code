/**
 * ClaudeCodeSessionParser layer implementation.
 *
 * Streams Claude Code JSONL session files line-by-line (no full-file loading),
 * maps content blocks (thinking/tool_use to activities, text to messages),
 * filters sidechain and meta-injected lines.
 *
 * @module ClaudeCodeSessionParserLive
 */
import { Effect, FileSystem, Layer, Option, Schema, Stream } from "effect";

import { HistoryImportParseError } from "../Errors.ts";
import {
  ClaudeCodeAssistantLine,
  ClaudeCodeUserLine,
} from "../Schemas/ClaudeCodeSessionSchemas.ts";
import {
  ClaudeCodeSessionParserService,
  type ClaudeCodeSessionParserShape,
  type ClaudeCodeParseResult,
  type ParsedClaudeCodeActivity,
  type ParsedClaudeCodeMessage,
} from "../Services/ClaudeCodeSessionParser.ts";

// ── Parser State ──────────────────────────────────────────────────────

interface ParserState {
  sessionId: string | null;
  sessionMeta: ClaudeCodeParseResult["sessionMeta"];
  messages: ParsedClaudeCodeMessage[];
  activities: ParsedClaudeCodeActivity[];
  warnings: string[];
  linesProcessed: number;
  messageCapped: boolean;
  activityCapped: boolean;
  maxMessages: number;
  maxActivities: number;
  lastAssistantUuid: string | null;
  lastAssistantHasFollowup: boolean;
  model: string | null;
}

function makeInitialState(maxMessages: number, maxActivities: number): ParserState {
  return {
    sessionId: null,
    sessionMeta: null,
    messages: [],
    activities: [],
    warnings: [],
    linesProcessed: 0,
    messageCapped: false,
    activityCapped: false,
    maxMessages,
    maxActivities,
    lastAssistantUuid: null,
    lastAssistantHasFollowup: false,
    model: null,
  };
}

// ── Helper: Push message with cap check ──────────────────────────────

function pushMessage(state: ParserState, msg: ParsedClaudeCodeMessage): void {
  if (state.messageCapped) return;
  state.messages.push(msg);
  if (state.messages.length >= state.maxMessages) {
    state.messageCapped = true;
  }
}

function pushActivity(state: ParserState, act: ParsedClaudeCodeActivity): void {
  if (state.activityCapped) return;
  state.activities.push(act);
  if (state.activities.length >= state.maxActivities) {
    state.activityCapped = true;
  }
}

// ── Skippable line types ─────────────────────────────────────────────

const SKIP_TYPES = new Set(["progress", "system", "file-history-snapshot", "queue-operation"]);

// ── Line Processing ───────────────────────────────────────────────────

function processLine(state: ParserState, line: string, lineNumber: number): void {
  state.linesProcessed++;

  // Try to parse JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    state.warnings.push(`Malformed JSON at line ${lineNumber} (skipped)`);
    return;
  }

  // Quick type check for skippable line types
  const lineType = parsed.type;
  if (typeof lineType === "string" && SKIP_TYPES.has(lineType)) {
    return;
  }

  // Skip sidechain lines
  if (parsed.isSidechain === true) {
    return;
  }

  // Extract session metadata from first non-skipped line
  if (!state.sessionId && typeof parsed.sessionId === "string") {
    state.sessionId = parsed.sessionId;
  }
  if (!state.sessionMeta) {
    const cwd = typeof parsed.cwd === "string" ? parsed.cwd : null;
    const version = typeof parsed.version === "string" ? parsed.version : null;
    const gitBranch = typeof parsed.gitBranch === "string" ? parsed.gitBranch : null;
    if (cwd || version || gitBranch) {
      state.sessionMeta = { cwd, model: null, version, gitBranch };
    }
  }

  // Try to decode as assistant line
  if (lineType === "assistant") {
    const decoded = Schema.decodeUnknownOption(ClaudeCodeAssistantLine)(parsed);
    if (Option.isSome(decoded)) {
      processAssistantLine(state, decoded.value);
      return;
    }
  }

  // Try to decode as user line
  if (lineType === "user") {
    const decoded = Schema.decodeUnknownOption(ClaudeCodeUserLine)(parsed);
    if (Option.isSome(decoded)) {
      processUserLine(state, decoded.value);
      return;
    }
  }

  // Unknown line type: skip silently (schema tolerance)
}

// ── Assistant Line Processing ─────────────────────────────────────────

function processAssistantLine(
  state: ParserState,
  line: typeof ClaudeCodeAssistantLine.Type,
): void {
  const timestamp = line.timestamp;
  const turnId = line.uuid;

  // Track as potential last assistant UUID for resume seed
  state.lastAssistantUuid = line.uuid;
  state.lastAssistantHasFollowup = false;

  // Extract model if not yet set
  if (!state.model && line.message.model) {
    state.model = line.message.model;
    // Update sessionMeta with model
    if (state.sessionMeta) {
      state.sessionMeta = { ...state.sessionMeta, model: state.model };
    }
  }

  // Process content blocks
  let accumulatedText = "";

  for (const block of line.message.content) {
    switch (block.type) {
      case "thinking": {
        // Map thinking to activity, NOT to message text (FR-5)
        const thinkingText = block.thinking;
        pushActivity(state, {
          kind: "thinking",
          tone: "info",
          summary: thinkingText.slice(0, 200),
          turnId,
          createdAt: timestamp,
          payload: null,
        });
        break;
      }

      case "tool_use": {
        // Map tool_use to activity, NOT to message text (FR-5)
        const truncatedInput = JSON.stringify(block.input).slice(0, 150);
        pushActivity(state, {
          kind: "tool_use",
          tone: "tool",
          summary: `${block.name}(${truncatedInput})`,
          turnId,
          createdAt: timestamp,
          payload: { id: block.id, name: block.name, input: block.input },
        });
        break;
      }

      case "text": {
        accumulatedText += block.text;
        break;
      }
    }
  }

  // Create message from accumulated text blocks
  if (accumulatedText) {
    pushMessage(state, {
      role: "assistant",
      text: accumulatedText,
      createdAt: timestamp,
      turnId,
      isStreaming: false, // Will be updated in post-processing for incomplete last message
    });
  }
}

// ── User Line Processing ──────────────────────────────────────────────

function processUserLine(
  state: ParserState,
  line: typeof ClaudeCodeUserLine.Type,
): void {
  // Skip meta-injected messages (system injections, not real user input)
  if (line.isMeta) return;

  const timestamp = line.timestamp;
  const content = line.message.content;

  // Mark that the last assistant message has a followup
  state.lastAssistantHasFollowup = true;

  // Handle tool execution result (toolUseResult field on the raw line)
  if (line.toolUseResult) {
    const result = line.toolUseResult;
    const stdout = result.stdout || "";
    const summary = stdout ? stdout.slice(0, 200) : "Tool execution";
    pushActivity(state, {
      kind: "tool_execution",
      tone: "tool",
      summary,
      turnId: null,
      createdAt: timestamp,
      payload: { stdout: result.stdout, stderr: result.stderr, interrupted: result.interrupted },
    });
  }

  if (typeof content === "string") {
    // Simple string content: create user message
    pushMessage(state, {
      role: "user",
      text: content,
      createdAt: timestamp,
      turnId: null,
      isStreaming: false,
    });
  } else if (Array.isArray(content)) {
    // Array content: extract text blocks as message, tool_result as activities
    let userText = "";

    for (const block of content) {
      if (block.type === "text") {
        userText += block.text;
      } else if (block.type === "tool_result") {
        pushActivity(state, {
          kind: "tool_result",
          tone: "tool",
          summary: `Tool result for ${block.tool_use_id}`,
          turnId: null,
          createdAt: timestamp,
          payload: { content: block.content },
        });
      }
    }

    if (userText) {
      pushMessage(state, {
        role: "user",
        text: userText,
        createdAt: timestamp,
        turnId: null,
        isStreaming: false,
      });
    }
  }
}

// ── Post-Processing ───────────────────────────────────────────────────

/**
 * Pitfall 2: Incomplete message detection.
 * An assistant message with stop_reason: null is incomplete ONLY if it is
 * the absolute last assistant message AND there is no subsequent user message.
 * All other stop_reason: null messages are valid intermediate responses.
 */
function postProcess(state: ParserState): void {
  // Find the last assistant message and check if it might be incomplete
  if (state.messages.length > 0 && state.lastAssistantUuid && !state.lastAssistantHasFollowup) {
    // Check if the last message is from assistant
    const lastMsg = state.messages[state.messages.length - 1]!;
    if (lastMsg.role === "assistant") {
      // This is the last assistant message with no followup user message
      // Mark as potentially streaming/incomplete
      state.messages[state.messages.length - 1] = { ...lastMsg, isStreaming: true };
    }
  }
}

// ── Layer Implementation ──────────────────────────────────────────────

/**
 * Layer construction acquires FileSystem at build time so the parse method
 * does not leak FileSystem into its return type.
 */
const makeClaudeCodeSessionParser = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  /**
   * Stream lines from a JSONL file using Effect FileSystem.
   * Never loads the full file into memory.
   */
  const streamLines = (filePath: string) =>
    fs.stream(filePath, { chunkSize: FileSystem.KiB(64) }).pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.filter((line) => line.trim().length > 0),
    );

  const parse: ClaudeCodeSessionParserShape["parse"] = (filePath, options) =>
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

      // Post-processing: detect incomplete last assistant message
      postProcess(state);

      const result: ClaudeCodeParseResult = {
        sessionId: state.sessionId,
        sessionMeta: state.sessionMeta,
        messages: state.messages,
        activities: state.activities,
        warnings: state.warnings,
        totalLinesProcessed: state.linesProcessed,
        lastAssistantUuid: state.lastAssistantUuid,
      };

      return result;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HistoryImportParseError({
            message: `Failed to parse Claude Code session file: ${filePath}`,
            cause,
          }),
      ),
      Effect.withSpan("ClaudeCodeSessionParser.parse"),
    );

  return { parse } satisfies ClaudeCodeSessionParserShape;
});

export const ClaudeCodeSessionParserLive = Layer.effect(
  ClaudeCodeSessionParserService,
  makeClaudeCodeSessionParser,
);
