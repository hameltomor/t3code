/**
 * Effect schemas for Codex JSONL rollout file format.
 *
 * All schemas tolerate unknown fields via `onExcessProperty: "ignore"` to
 * satisfy NFR-5 (schema tolerance for forward-compatible parsing).
 *
 * @module CodexRolloutSchemas
 */
import { Schema } from "effect";

const tolerant = { parseOptions: { onExcessProperty: "ignore" as const } };

// ── Session Meta ────────────────────────────────────────────────────

export const CodexSessionMeta = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  originator: Schema.optional(Schema.String),
  cli_version: Schema.optional(Schema.String),
  source: Schema.Unknown, // "cli" | "vscode" | { sub_agent: ... }
  agent_nickname: Schema.optional(Schema.NullOr(Schema.String)),
  agent_role: Schema.optional(Schema.NullOr(Schema.String)),
  model_provider: Schema.optional(Schema.String),
  base_instructions: Schema.optional(Schema.String),
}).annotate(tolerant);
export type CodexSessionMeta = typeof CodexSessionMeta.Type;

// ── Response Item ───────────────────────────────────────────────────

const CodexResponseItemContent = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
}).annotate(tolerant);

export const CodexResponseItem = Schema.Struct({
  type: Schema.String, // "message" | "reasoning" | "local_shell_call" | "function_call" | ...
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Array(CodexResponseItemContent)),
  summary: Schema.optional(Schema.Array(CodexResponseItemContent)),
  encrypted_content: Schema.optional(Schema.String),
}).annotate(tolerant);
export type CodexResponseItem = typeof CodexResponseItem.Type;

// ── Compacted Item ──────────────────────────────────────────────────

export const CodexCompactedItem = Schema.Struct({
  message: Schema.String,
  replacement_history: Schema.optional(Schema.Array(CodexResponseItem)),
}).annotate(tolerant);
export type CodexCompactedItem = typeof CodexCompactedItem.Type;

// ── Turn Context ────────────────────────────────────────────────────

export const CodexTurnContext = Schema.Struct({
  turn_id: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  approval_policy: Schema.optional(Schema.String),
}).annotate(tolerant);
export type CodexTurnContext = typeof CodexTurnContext.Type;

// ── Event Message ───────────────────────────────────────────────────

export const CodexEventMsg = Schema.Struct({
  type: Schema.String,
  message: Schema.optional(Schema.String),
  turn_id: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  exit_code: Schema.optional(Schema.Number),
  info: Schema.optional(Schema.Unknown),
  images: Schema.optional(Schema.Array(Schema.String)),
}).annotate(tolerant);
export type CodexEventMsg = typeof CodexEventMsg.Type;

// ── Top-Level Rollout Line ──────────────────────────────────────────

export const CodexRolloutLine = Schema.Struct({
  timestamp: Schema.optional(Schema.String),
  type: Schema.String, // "session_meta" | "response_item" | "compacted" | "turn_context" | "event_msg"
  payload: Schema.Unknown,
}).annotate(tolerant);
export type CodexRolloutLine = typeof CodexRolloutLine.Type;

// ── Session Meta Line (typed payload variant) ───────────────────────

export const CodexSessionMetaLine = Schema.Struct({
  timestamp: Schema.optional(Schema.String),
  type: Schema.Literal("session_meta"),
  payload: Schema.Struct({
    meta: CodexSessionMeta,
    git: Schema.optional(
      Schema.Struct({
        commit_hash: Schema.optional(Schema.String),
        branch: Schema.optional(Schema.String),
        repository_url: Schema.optional(Schema.String),
      }).annotate(tolerant),
    ),
  }).annotate(tolerant),
}).annotate(tolerant);
export type CodexSessionMetaLine = typeof CodexSessionMetaLine.Type;

// ── Helper Functions ────────────────────────────────────────────────

/**
 * Returns true for interactive sources ("cli", "vscode"), false for
 * sub-agent objects, "exec", "mcp", and anything else.
 */
export function isInteractiveSource(source: unknown): boolean {
  return source === "cli" || source === "vscode";
}

/**
 * Returns true if the session meta indicates a sub-agent session.
 * Sub-agents have non-interactive sources or non-null agent_nickname.
 */
export function isSubAgentSession(meta: CodexSessionMeta): boolean {
  return !isInteractiveSource(meta.source) || (meta.agent_nickname != null);
}
