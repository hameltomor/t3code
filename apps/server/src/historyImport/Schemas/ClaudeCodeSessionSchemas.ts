/**
 * Effect schemas for Claude Code JSONL session file format.
 *
 * All schemas tolerate unknown fields via `onExcessProperty: "ignore"` to
 * satisfy NFR-5 (schema tolerance for forward-compatible parsing).
 *
 * @module ClaudeCodeSessionSchemas
 */
import { Schema } from "effect";

const tolerant = { parseOptions: { onExcessProperty: "ignore" as const } };

// ── Forward-Encode Helper ────────────────────────────────────────────

/**
 * Forward-encodes a workspace path by replacing `/` and `.` with `-`.
 * This matches how Claude Code encodes workspace paths into project directory names.
 * The encoding is lossy (cannot be decoded) -- always encode and match, never decode.
 */
export function forwardEncodeClaudeCodePath(workspacePath: string): string {
  return workspacePath.replace(/[/.]/g, "-");
}

// ── Base Line Fields ─────────────────────────────────────────────────

export const ClaudeCodeLineBase = Schema.Struct({
  uuid: Schema.String,
  timestamp: Schema.String,
  sessionId: Schema.String,
  cwd: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  gitBranch: Schema.optional(Schema.String),
  parentUuid: Schema.NullOr(Schema.String),
  isSidechain: Schema.optional(Schema.Boolean.pipe(Schema.withDecodingDefault(() => false))),
  isMeta: Schema.optional(Schema.Boolean.pipe(Schema.withDecodingDefault(() => false))),
}).annotate(tolerant);
export type ClaudeCodeLineBase = typeof ClaudeCodeLineBase.Type;

// ── Assistant Content Blocks ─────────────────────────────────────────

const ClaudeCodeThinkingBlock = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.String,
}).annotate(tolerant);

const ClaudeCodeToolUseBlock = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
}).annotate(tolerant);

const ClaudeCodeTextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate(tolerant);

export const ClaudeCodeAssistantContentBlock = Schema.Union([
  ClaudeCodeThinkingBlock,
  ClaudeCodeToolUseBlock,
  ClaudeCodeTextBlock,
]);
export type ClaudeCodeAssistantContentBlock = typeof ClaudeCodeAssistantContentBlock.Type;

// ── User Content Blocks ──────────────────────────────────────────────

const ClaudeCodeUserTextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate(tolerant);

const ClaudeCodeToolResultBlock = Schema.Struct({
  type: Schema.Literal("tool_result"),
  tool_use_id: Schema.String,
  content: Schema.String,
}).annotate(tolerant);

export const ClaudeCodeUserContentBlock = Schema.Union([
  ClaudeCodeUserTextBlock,
  ClaudeCodeToolResultBlock,
]);
export type ClaudeCodeUserContentBlock = typeof ClaudeCodeUserContentBlock.Type;

// ── Assistant Line ───────────────────────────────────────────────────

export const ClaudeCodeAssistantLine = Schema.Struct({
  ...ClaudeCodeLineBase.fields,
  type: Schema.Literal("assistant"),
  message: Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.Array(ClaudeCodeAssistantContentBlock),
    stop_reason: Schema.NullOr(Schema.String),
    model: Schema.optional(Schema.String),
  }).annotate(tolerant),
}).annotate(tolerant);
export type ClaudeCodeAssistantLine = typeof ClaudeCodeAssistantLine.Type;

// ── User Line ────────────────────────────────────────────────────────

export const ClaudeCodeUserLine = Schema.Struct({
  ...ClaudeCodeLineBase.fields,
  type: Schema.Literal("user"),
  message: Schema.Struct({
    role: Schema.Literal("user"),
    content: Schema.Union([
      Schema.String,
      Schema.Array(ClaudeCodeUserContentBlock),
    ]),
  }).annotate(tolerant),
  toolUseResult: Schema.optional(
    Schema.Struct({
      stdout: Schema.String,
      stderr: Schema.String,
      interrupted: Schema.Boolean,
    }).annotate(tolerant),
  ),
}).annotate(tolerant);
export type ClaudeCodeUserLine = typeof ClaudeCodeUserLine.Type;

// ── Sessions Index ───────────────────────────────────────────────────

export const ClaudeCodeSessionsIndexEntry = Schema.Struct({
  sessionId: Schema.String,
  fullPath: Schema.String,
  fileMtime: Schema.Number,
  firstPrompt: Schema.String,
  summary: Schema.String,
  messageCount: Schema.Number,
  created: Schema.String,
  modified: Schema.String,
  gitBranch: Schema.String,
  projectPath: Schema.String,
  isSidechain: Schema.Boolean,
}).annotate(tolerant);
export type ClaudeCodeSessionsIndexEntry = typeof ClaudeCodeSessionsIndexEntry.Type;

export const ClaudeCodeSessionsIndex = Schema.Struct({
  version: Schema.Number,
  entries: Schema.Array(ClaudeCodeSessionsIndexEntry),
}).annotate(tolerant);
export type ClaudeCodeSessionsIndex = typeof ClaudeCodeSessionsIndex.Type;
