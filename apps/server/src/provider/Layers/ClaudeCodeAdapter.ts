/**
 * ClaudeCodeAdapterLive - Scoped live implementation for the Claude Code provider adapter.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` query sessions behind the generic
 * provider adapter contract and emits canonical runtime events.
 *
 * @module ClaudeCodeAdapterLive
 */
import {
  type CanUseTool,
  type McpServerConfig,
  query,
  type Options as ClaudeQueryOptions,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type SDKMessage,
  type SpawnOptions as ClaudeSpawnOptions,
  type SpawnedProcess as ClaudeSpawnedProcess,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { spawn as spawnChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  ApprovalRequestId,
  type CanonicalItemType,
  type CanonicalRequestType,
  EventId,
  type ProviderApprovalDecision,
  ProviderItemId,
  type ProviderRuntimeEvent,
  type ProviderRuntimeTurnStatus,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
} from "@xbetools/contracts";
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Queue, Random, Ref, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { ClaudeCodeAdapter, type ClaudeCodeAdapterShape } from "../Services/ClaudeCodeAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import {
  materializeFileAttachments,
  materializeImageAttachments,
  type MaterializedFileAttachment,
  type MaterializedImageAttachment,
} from "../attachmentMaterializer.ts";
import { normalizeClaudeUsage } from "../normalization/tokenUsageNormalization.ts";
import {
  applyClaudePromptEffortPrefix,
  getEffectiveClaudeCodeEffort,
  getReasoningEffortOptions,
  resolveReasoningEffortForProvider,
  supportsClaudeFastMode,
  supportsClaudeThinkingToggle,
} from "@xbetools/shared/model";

const PROVIDER = "claudeCode" as const;
const CLAUDE_SETTING_SOURCES = ["user", "project", "local"] as const;
const CLAUDE_CODE_PRESET = { type: "preset", preset: "claude_code" } as const;

/**
 * Strip env vars that cause the Claude Code CLI to refuse to start
 * (e.g. when the XBE Code server is launched from within a Claude Code session,
 * CLAUDECODE=1 is inherited and triggers the nested-session guard).
 */
const STRIPPED_ENV_KEYS = ["CLAUDECODE", "CLAUDE_CODE_SSE_PORT"];
function sanitizedEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const key of STRIPPED_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

/**
 * Discover MCP server configs from the Claude CLI's internal storage.
 *
 * The Claude CLI stores MCP configs in `~/.claude.json`, NOT in the
 * `~/.claude/settings.json` files that `settingSources` reads from.
 *
 * - User-scope servers: `~/.claude.json` → top-level `mcpServers`
 * - Local-scope servers: `~/.claude.json` → `projects[cwd].mcpServers`
 * - Project-scope servers: `{cwd}/.mcp.json` → `mcpServers`
 */
function discoverClaudeCliMcpServers(cwd: string | undefined): Record<string, McpServerConfig> {
  const merged: Record<string, McpServerConfig> = {};

  // 1. Read ~/.claude.json for user-scope and local-scope servers
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");
  try {
    const raw = fs.readFileSync(claudeJsonPath, "utf-8");
    const data = JSON.parse(raw) as {
      mcpServers?: Record<string, McpServerConfig>;
      projects?: Record<string, { mcpServers?: Record<string, McpServerConfig> }>;
    };

    // User-scope MCP servers
    if (data.mcpServers) {
      Object.assign(merged, data.mcpServers);
    }

    // Local-scope MCP servers (project-specific, private to user)
    if (cwd && data.projects) {
      const projectConfig = data.projects[cwd];
      if (projectConfig?.mcpServers) {
        Object.assign(merged, projectConfig.mcpServers);
      }
    }
  } catch {
    // File doesn't exist or is invalid JSON — not an error
  }

  // 2. Read {cwd}/.mcp.json for project-scope servers
  if (cwd) {
    const mcpJsonPath = path.join(cwd, ".mcp.json");
    try {
      const raw = fs.readFileSync(mcpJsonPath, "utf-8");
      const data = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
      if (data.mcpServers) {
        Object.assign(merged, data.mcpServers);
      }
    } catch {
      // File doesn't exist or is invalid JSON — not an error
    }
  }

  return merged;
}

type PromptQueueItem =
  | {
      readonly type: "message";
      readonly message: SDKUserMessage;
    }
  | {
      readonly type: "terminate";
    };

interface ClaudeResumeState {
  readonly threadId?: ThreadId;
  readonly resume?: string;
  readonly resumeSessionAt?: string;
  readonly turnCount?: number;
}

interface ClaudeTurnState {
  readonly turnId: TurnId;
  readonly startedAt: string;
  readonly items: Array<unknown>;
  readonly assistantTextBlocks: Map<number, AssistantTextBlockState>;
  readonly assistantTextBlockOrder: Array<AssistantTextBlockState>;
  nextSyntheticAssistantBlockIndex: number;
}

interface AssistantTextBlockState {
  readonly itemId: string;
  readonly blockIndex: number;
  emittedTextDelta: boolean;
  fallbackText: string;
  streamClosed: boolean;
  completionEmitted: boolean;
}

interface PendingApproval {
  readonly requestType: CanonicalRequestType;
  readonly detail?: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface ToolInFlight {
  readonly itemId: string;
  readonly itemType: CanonicalItemType;
  readonly toolName: string;
  readonly title: string;
  readonly detail?: string;
  input: Record<string, unknown>;
  /** Accumulated JSON fragments from `input_json_delta` events. */
  inputJsonParts: string[];
}

interface ClaudeSessionContext {
  /** Orchestrator's routing key — always set, used for Map/event routing. */
  readonly sessionKey: ThreadId;
  session: ProviderSession;
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly query: ClaudeQueryRuntime;
  streamFiber: Fiber.Fiber<void, never> | undefined;
  readonly startedAt: string;
  readonly basePermissionMode: PermissionMode | undefined;
  resumeSessionId: string | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{
    id: TurnId;
    items: Array<unknown>;
  }>;
  readonly inFlightTools: Map<number, ToolInFlight>;
  turnState: ClaudeTurnState | undefined;
  lastAssistantUuid: string | undefined;
  lastThreadStartedId: string | undefined;
  stopped: boolean;
}

interface ClaudeQueryRuntime extends AsyncIterable<SDKMessage> {
  readonly interrupt: () => Promise<void>;
  readonly setModel: (model?: string) => Promise<void>;
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
  readonly setMaxThinkingTokens: (maxThinkingTokens: number | null) => Promise<void>;
  readonly close: () => void;
}

export interface ClaudeCodeAdapterLiveOptions {
  readonly createQuery?: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: ClaudeQueryOptions;
  }) => ClaudeQueryRuntime;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly stateDir?: string;
}

/**
 * Convert an Effect queue into an async iterable that **never rejects**.
 *
 * The Claude Agent SDK fires `streamInput(prompt)` in a detached async task
 * that is neither awaited nor wrapped in a try-catch.  If our `next()` ever
 * rejects, the rejection becomes unhandled and crashes the Node process.
 *
 * Defence-in-depth: the outer try-catch absorbs any rejection that
 * `Effect.runPromiseExit` may produce during scope/runtime teardown in
 * effect-smol, which the inner `Exit.isFailure` path cannot catch.
 */
function promptQueueToAsyncIterable(
  promptQueue: Queue.Dequeue<PromptQueueItem>,
): AsyncIterable<SDKUserMessage> {
  const DONE: IteratorResult<SDKUserMessage> = { done: true, value: undefined };

  return {
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      let done = false;

      return {
        next: async (): Promise<IteratorResult<SDKUserMessage>> => {
          if (done) {
            return DONE;
          }

          try {
            while (true) {
              const exit = await Effect.runPromiseExit(Queue.take(promptQueue));
              if (Exit.isFailure(exit)) {
                done = true;
                return DONE;
              }

              const item = exit.value;
              if (item.type === "terminate") {
                done = true;
                return DONE;
              }

              return { done: false, value: item.message };
            }
          } catch {
            // Effect.runPromiseExit rejected during runtime/scope teardown.
            // End the stream cleanly so the SDK's detached consumer does not
            // produce an unhandled rejection.
            done = true;
            return DONE;
          }
        },
        return: async (): Promise<IteratorResult<SDKUserMessage>> => {
          done = true;
          return DONE;
        },
      };
    },
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSyntheticClaudeThreadId(value: string): boolean {
  return value.startsWith("claude-thread-");
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}
function toError(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(toMessage(cause, fallback));
}


/**
 * Extract extended error details from the Claude Agent SDK error.
 * The SDK may attach `stderr`, `stdout`, `code`, or `exitCode` to the error
 * when the underlying Claude Code process crashes.
 */
function extractProcessErrorDetail(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const record = cause as unknown as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.stderr === "string" && record.stderr.trim().length > 0) {
    parts.push(`stderr: ${record.stderr.trim()}`);
  }
  if (typeof record.stdout === "string" && record.stdout.trim().length > 0) {
    parts.push(`stdout: ${record.stdout.trim()}`);
  }
  if (typeof record.exitCode === "number") {
    parts.push(`exitCode: ${record.exitCode}`);
  } else if (typeof record.code === "number") {
    parts.push(`code: ${record.code}`);
  }
  if (cause.cause !== undefined) {
    const inner = cause.cause;
    if (inner instanceof Error && inner.message.length > 0) {
      parts.push(`cause: ${inner.message}`);
    }
  }
  return parts.length > 0 ? parts.join("; ") : undefined;
}

type ClaudeSdkChildSpawner = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    readonly cwd?: string;
    readonly env: NodeJS.ProcessEnv;
    readonly signal: AbortSignal;
    readonly stdio: ["pipe", "pipe", "ignore"];
    readonly windowsHide: true;
  },
) => ClaudeSpawnedProcess;

export function resolveClaudeCodeSpawnCommand(
  command: string,
  execPath = process.execPath,
): string {
  if (command !== "node") return command;
  const normalizedExecPath = execPath.trim();
  return normalizedExecPath.length > 0 ? normalizedExecPath : command;
}

export function createClaudeCodeProcessSpawner(
  execPath = process.execPath,
  spawnProcess: ClaudeSdkChildSpawner = (command, args, options) =>
    spawnChildProcess(command, [...args], options) as unknown as ClaudeSpawnedProcess,
): NonNullable<ClaudeQueryOptions["spawnClaudeCodeProcess"]> {
  return (input: ClaudeSpawnOptions) => {
    const command = resolveClaudeCodeSpawnCommand(input.command, execPath);
    const env =
      command === execPath
        ? {
            ...input.env,
            ELECTRON_RUN_AS_NODE: input.env.ELECTRON_RUN_AS_NODE ?? "1",
          }
        : input.env;

    return spawnProcess(command, input.args, {
      ...(input.cwd ? { cwd: input.cwd } : {}),
      env,
      signal: input.signal,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
  };
}

function asRuntimeItemId(value: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(value);
}

function asCanonicalTurnId(value: TurnId): TurnId {
  return value;
}

function asRuntimeRequestId(value: ApprovalRequestId): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(value);
}

function toPermissionMode(value: unknown): PermissionMode | undefined {
  switch (value) {
    case "default":
    case "acceptEdits":
    case "bypassPermissions":
    case "plan":
    case "dontAsk":
      return value;
    default:
      return undefined;
  }
}

function readClaudeResumeState(resumeCursor: unknown): ClaudeResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const cursor = resumeCursor as {
    threadId?: unknown;
    resume?: unknown;
    sessionId?: unknown;
    resumeSessionAt?: unknown;
    turnCount?: unknown;
  };

  const threadIdCandidate = typeof cursor.threadId === "string" ? cursor.threadId : undefined;
  const threadId =
    threadIdCandidate && !isSyntheticClaudeThreadId(threadIdCandidate)
      ? ThreadId.makeUnsafe(threadIdCandidate)
      : undefined;
  const resumeCandidate =
    typeof cursor.resume === "string"
      ? cursor.resume
      : typeof cursor.sessionId === "string"
        ? cursor.sessionId
        : undefined;
  const resume = resumeCandidate && isUuid(resumeCandidate) ? resumeCandidate : undefined;
  const resumeSessionAt =
    typeof cursor.resumeSessionAt === "string" ? cursor.resumeSessionAt : undefined;
  const turnCountValue = typeof cursor.turnCount === "number" ? cursor.turnCount : undefined;

  return {
    ...(threadId ? { threadId } : {}),
    ...(resume ? { resume } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
    ...(turnCountValue !== undefined && Number.isInteger(turnCountValue) && turnCountValue >= 0
      ? { turnCount: turnCountValue }
      : {}),
  };
}

function classifyToolItemType(toolName: string): CanonicalItemType {
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("task") ||
    normalized.includes("subagent") ||
    normalized.includes("agent")
  ) {
    return "collab_agent_tool_call";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("file") ||
    normalized.includes("patch") ||
    normalized.includes("replace") ||
    normalized.includes("create") ||
    normalized.includes("delete")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("websearch") || normalized.includes("web search")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  return "dynamic_tool_call";
}

function isReadOnlyToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized === "read" ||
    normalized.includes("read file") ||
    normalized.includes("view") ||
    normalized.includes("grep") ||
    normalized.includes("glob") ||
    normalized.includes("search")
  );
}

function classifyRequestType(toolName: string): CanonicalRequestType {
  if (isReadOnlyToolName(toolName)) {
    return "file_read_approval";
  }
  const itemType = classifyToolItemType(toolName);
  return itemType === "command_execution"
    ? "command_execution_approval"
    : itemType === "file_change"
      ? "file_change_approval"
      : "dynamic_tool_call";
}

function summarizeToolRequest(toolName: string, input: Record<string, unknown>): string {
  const commandValue = input.command ?? input.cmd;
  const command = typeof commandValue === "string" ? commandValue : undefined;
  if (command && command.trim().length > 0) {
    return `${toolName}: ${command.trim().slice(0, 400)}`;
  }

  const serialized = JSON.stringify(input);
  if (serialized.length <= 400) {
    return `${toolName}: ${serialized}`;
  }
  return `${toolName}: ${serialized.slice(0, 397)}...`;
}

function titleForTool(itemType: CanonicalItemType): string {
  switch (itemType) {
    case "command_execution":
      return "Command run";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "collab_agent_tool_call":
      return "Subagent task";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "dynamic_tool_call":
      return "Tool call";
    default:
      return "Item";
  }
}

function parseAccumulatedToolInput(parts: string[]): Record<string, unknown> {
  if (parts.length === 0) return {};
  try {
    return JSON.parse(parts.join("")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeClaudeStreamMessages(cause: Cause.Cause<Error>): ReadonlyArray<string> {
  const errors = Cause.prettyErrors(cause)
    .map((error) => error.message.trim())
    .filter((message) => message.length > 0);
  if (errors.length > 0) {
    return errors;
  }

  const squashed = toMessage(Cause.squash(cause), "").trim();
  return squashed.length > 0 ? [squashed] : [];
}

function isClaudeInterruptedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("all fibers interrupted without error") ||
    normalized.includes("request was aborted") ||
    normalized.includes("interrupted by user")
  );
}

function isClaudeInterruptedCause(cause: Cause.Cause<Error>): boolean {
  return (
    Cause.hasInterruptsOnly(cause) ||
    normalizeClaudeStreamMessages(cause).some(isClaudeInterruptedMessage)
  );
}

function messageFromClaudeStreamCause(cause: Cause.Cause<Error>, fallback: string): string {
  return normalizeClaudeStreamMessages(cause)[0] ?? fallback;
}

function interruptionMessageFromClaudeCause(cause: Cause.Cause<Error>): string {
  const message = messageFromClaudeStreamCause(cause, "Claude runtime interrupted.");
  return isClaudeInterruptedMessage(message) ? "Claude runtime interrupted." : message;
}

function buildPromptText(input: ProviderSendTurnInput): string {
  const requestedEffort = resolveReasoningEffortForProvider(
    "claudeCode",
    input.modelOptions?.claudeCode?.effort ?? null,
    input.model,
  );
  const supportedEffortOptions = getReasoningEffortOptions("claudeCode", input.model);
  const promptEffort =
    requestedEffort === "ultrathink" && supportedEffortOptions.includes(requestedEffort)
      ? "ultrathink"
      : null;
  return applyClaudePromptEffortPrefix(input.input?.trim() ?? "", promptEffort);
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractTextContent(entry)).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as {
    text?: unknown;
    content?: unknown;
  };
  if (typeof record.text === "string") {
    return record.text;
  }
  return extractTextContent(record.content);
}

function toolResultStreamKind(
  itemType: CanonicalItemType,
): "command_output" | "file_change_output" | undefined {
  switch (itemType) {
    case "command_execution":
      return "command_output";
    case "file_change":
      return "file_change_output";
    default:
      return undefined;
  }
}

function toolResultBlocksFromUserMessage(message: SDKMessage): Array<{
  readonly toolUseId: string;
  readonly block: Record<string, unknown>;
  readonly text: string;
  readonly isError: boolean;
}> {
  if (message.type !== "user") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: Array<{
    readonly toolUseId: string;
    readonly block: Record<string, unknown>;
    readonly text: string;
    readonly isError: boolean;
  }> = [];

  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const block = entry as Record<string, unknown>;
    if (block.type !== "tool_result") {
      continue;
    }
    const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
    if (!toolUseId) {
      continue;
    }
    blocks.push({
      toolUseId,
      block,
      text: extractTextContent(block.content),
      isError: block.is_error === true,
    });
  }

  return blocks;
}

/** MIME types that Claude supports natively as document content blocks. */
const CLAUDE_NATIVE_DOCUMENT_MIMES = new Set(["application/pdf"]);

function buildUserMessage(
  input: ProviderSendTurnInput,
  materializedImages?: MaterializedImageAttachment[],
  materializedFiles?: MaterializedFileAttachment[],
): SDKUserMessage {
  const content: Array<Record<string, unknown>> = [];

  const text = buildPromptText(input);
  if (text.length > 0) {
    content.push({ type: "text", text });
  }

  // Add real image content blocks for materialized attachments
  const materializedIds = new Set(materializedImages?.map((img) => img.id) ?? []);
  if (materializedImages && materializedImages.length > 0) {
    for (const img of materializedImages) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mimeType,
          data: img.base64,
        },
      });
    }
  }

  // Add file attachment content blocks
  const materializedFileIds = new Set(materializedFiles?.map((f) => f.id) ?? []);
  if (materializedFiles && materializedFiles.length > 0) {
    for (const file of materializedFiles) {
      materializedIds.add(file.id);
      if (CLAUDE_NATIVE_DOCUMENT_MIMES.has(file.mimeType.toLowerCase())) {
        // PDF: send as native document content block
        content.push({
          type: "document",
          source: {
            type: "base64",
            media_type: file.mimeType,
            data: file.base64,
          },
        });
      } else if (file.extractedText) {
        // Text-based documents: send extracted text
        content.push({
          type: "text",
          text: `[File: ${file.name}]\n${file.extractedText}`,
        });
      } else {
        content.push({
          type: "text",
          text: `[Attachment: ${file.name} (${file.mimeType})]`,
        });
      }
    }
  }

  // Text fallback for attachments that could not be materialized
  if (input.attachments && input.attachments.length > 0) {
    for (const attachment of input.attachments) {
      if (materializedIds.has(attachment.id) || materializedFileIds.has(attachment.id)) continue;
      if (attachment.name) {
        content.push({
          type: "text",
          text: `[Attachment: ${attachment.name} (${attachment.mimeType})]`,
        });
      }
    }
  }

  // Fallback: if no content was produced, send a minimal text block
  if (content.length === 0) {
    content.push({ type: "text", text: "Continue." });
  }

  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content,
    },
  } as SDKUserMessage;
}

function resultErrorsText(result: SDKResultMessage): string {
  return "errors" in result && Array.isArray(result.errors)
    ? result.errors.join(" ").toLowerCase()
    : "";
}

function isInterruptedResult(result: SDKResultMessage): boolean {
  const errors = resultErrorsText(result);
  if (errors.includes("interrupt")) {
    return true;
  }

  return (
    result.subtype === "error_during_execution" &&
    result.is_error === false &&
    (errors.includes("request was aborted") ||
      errors.includes("interrupted by user") ||
      errors.includes("aborted"))
  );
}

function turnStatusFromResult(result: SDKResultMessage): ProviderRuntimeTurnStatus {
  if (result.subtype === "success") {
    return "completed";
  }
  if (isInterruptedResult(result)) {
    return "interrupted";
  }
  const errors = resultErrorsText(result);
  if (errors.includes("cancel")) {
    return "cancelled";
  }
  return "failed";
}

function streamKindFromDeltaType(deltaType: string): "assistant_text" | "reasoning_text" {
  return deltaType.includes("thinking") ? "reasoning_text" : "assistant_text";
}

function providerThreadRef(
  context: ClaudeSessionContext,
): { readonly providerThreadId: string } | {} {
  return context.resumeSessionId ? { providerThreadId: context.resumeSessionId } : {};
}

function extractAssistantTextBlocks(message: SDKMessage): string[] {
  if (message.type !== "assistant") {
    return [];
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const fragments: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as { type?: unknown; text?: unknown };
    if (
      candidate.type === "text" &&
      typeof candidate.text === "string" &&
      candidate.text.length > 0
    ) {
      fragments.push(candidate.text);
    }
  }

  return fragments;
}

function extractContentBlockText(block: unknown): string {
  if (!block || typeof block !== "object") {
    return "";
  }
  const candidate = block as { text?: unknown };
  return typeof candidate.text === "string" ? candidate.text : "";
}

function toSessionError(
  threadId: ThreadId,
  cause: unknown,
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, "").toLowerCase();
  if (normalized.includes("unknown session") || normalized.includes("not found")) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  if (normalized.includes("closed")) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  return undefined;
}

function toRequestError(
  threadId: ThreadId,
  method: string,
  cause: unknown,
): ProviderAdapterError {
  const sessionError = toSessionError(threadId, cause);
  if (sessionError) {
    return sessionError;
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: toMessage(cause, `${method} failed`),
    cause,
  });
}

function sdkMessageType(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { type?: unknown };
  return typeof record.type === "string" ? record.type : undefined;
}

function sdkMessageSubtype(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { subtype?: unknown };
  return typeof record.subtype === "string" ? record.subtype : undefined;
}

function sdkNativeMethod(message: SDKMessage): string {
  const subtype = sdkMessageSubtype(message);
  if (subtype) {
    return `claude/${message.type}/${subtype}`;
  }

  if (message.type === "stream_event") {
    const streamType = sdkMessageType(message.event);
    if (streamType) {
      const deltaType =
        streamType === "content_block_delta"
          ? sdkMessageType((message.event as { delta?: unknown }).delta)
          : undefined;
      if (deltaType) {
        return `claude/${message.type}/${streamType}/${deltaType}`;
      }
      return `claude/${message.type}/${streamType}`;
    }
  }

  return `claude/${message.type}`;
}

function sdkNativeItemId(message: SDKMessage): string | undefined {
  if (message.type === "assistant") {
    const maybeId = (message.message as { id?: unknown }).id;
    if (typeof maybeId === "string") {
      return maybeId;
    }
    return undefined;
  }

  if (message.type === "stream_event") {
    const event = message.event as {
      type?: unknown;
      content_block?: { id?: unknown };
    };
    if (event.type === "content_block_start" && typeof event.content_block?.id === "string") {
      return event.content_block.id;
    }
  }

  return undefined;
}

function makeClaudeCodeAdapter(options?: ClaudeCodeAdapterLiveOptions) {
  return Effect.gen(function* () {
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);

    const createQuery =
      options?.createQuery ??
      ((input: {
        readonly prompt: AsyncIterable<SDKUserMessage>;
        readonly options: ClaudeQueryOptions;
      }) => query({ prompt: input.prompt, options: input.options }) as ClaudeQueryRuntime);

    const sessions = new Map<ThreadId, ClaudeSessionContext>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

    const offerRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

    const logNativeSdkMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!nativeEventLogger) {
          return;
        }

        const observedAt = new Date().toISOString();
        const itemId = sdkNativeItemId(message);

        yield* nativeEventLogger
          .write(
            {
              observedAt,
              event: {
                id:
                  "uuid" in message && typeof message.uuid === "string"
                    ? message.uuid
                    : crypto.randomUUID(),
                kind: "notification",
                provider: PROVIDER,
                createdAt: observedAt,
                method: sdkNativeMethod(message),
                threadId: context.session.threadId ?? context.sessionKey,
              ...(typeof message.session_id === "string"
                  ? { providerThreadId: message.session_id }
                  : {}),
                ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
                ...(itemId ? { itemId: ProviderItemId.makeUnsafe(itemId) } : {}),
                payload: message,
              },
            },
            null,
          );
      });

    const snapshotThread = (
      context: ClaudeSessionContext,
    ): Effect.Effect<{
      threadId: ThreadId;
      turns: ReadonlyArray<{
        id: TurnId;
        items: ReadonlyArray<unknown>;
      }>;
    }, ProviderAdapterValidationError> =>
      Effect.gen(function* () {
        const threadId = context.sessionKey;
        if (!threadId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "readThread",
            issue: "Session thread id is not initialized yet.",
          });
        }
        return {
          threadId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: [...turn.items],
          })),
        };
      });

    const updateResumeCursor = (context: ClaudeSessionContext): Effect.Effect<void> =>
      Effect.gen(function* () {
        const threadId = context.sessionKey;
        if (!threadId) return;

        const resumeCursor = {
          threadId,
          ...(context.resumeSessionId ? { resume: context.resumeSessionId } : {}),
          ...(context.lastAssistantUuid ? { resumeSessionAt: context.lastAssistantUuid } : {}),
          turnCount: context.turns.length,
        };

        context.session = {
          ...context.session,
          resumeCursor,
          updatedAt: yield* nowIso,
        };
      });

    const ensureThreadId = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (typeof message.session_id !== "string" || message.session_id.length === 0) {
          return;
        }
        const nextThreadId = message.session_id;
        context.resumeSessionId = message.session_id;
        if (!context.session.threadId) {
          context.session = {
            ...context.session,
            threadId: ThreadId.makeUnsafe(nextThreadId),
          };
        }
        yield* updateResumeCursor(context);

        if (context.lastThreadStartedId !== nextThreadId) {
          context.lastThreadStartedId = nextThreadId;
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "thread.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            payload: {
              providerThreadId: nextThreadId,
            },
            providerRefs: {},
            raw: {
              source: "claude.sdk.message",
              method: "claude/thread/started",
              payload: {
                session_id: message.session_id,
              },
            },
          });
        }
      });

    const emitRuntimeError = (
      context: ClaudeSessionContext,
      message: string,
      cause?: unknown,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (cause !== undefined) {
          void cause;
        }
        const turnState = context.turnState;
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "runtime.error",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.sessionKey,
          ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
          payload: {
            message,
            class: "provider_error",
            ...(cause !== undefined ? { detail: cause } : {}),
          },
          providerRefs: {
            ...providerThreadRef(context),
            ...(turnState ? { providerTurnId: String(turnState.turnId) } : {}),
          },
        });
      });

    const emitRuntimeWarning = (
      context: ClaudeSessionContext,
      message: string,
      detail?: unknown,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const turnState = context.turnState;
        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "runtime.warning",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.sessionKey,
          ...(turnState ? { turnId: asCanonicalTurnId(turnState.turnId) } : {}),
          payload: {
            message,
            ...(detail !== undefined ? { detail } : {}),
          },
          providerRefs: {
            ...providerThreadRef(context),
            ...(turnState ? { providerTurnId: String(turnState.turnId) } : {}),
          },
        });
      });

    const ensureAssistantTextBlock = (
      context: ClaudeSessionContext,
      blockIndex: number,
      options?: {
        readonly fallbackText?: string;
        readonly streamClosed?: boolean;
      },
    ): Effect.Effect<
      | {
          readonly blockIndex: number;
          readonly block: AssistantTextBlockState;
        }
      | undefined
    > =>
      Effect.gen(function* () {
        const turnState = context.turnState;
        if (!turnState) {
          return undefined;
        }

        const existing = turnState.assistantTextBlocks.get(blockIndex);
        if (existing && !existing.completionEmitted) {
          if (existing.fallbackText.length === 0 && options?.fallbackText) {
            existing.fallbackText = options.fallbackText;
          }
          if (options?.streamClosed) {
            existing.streamClosed = true;
          }
          return { blockIndex, block: existing };
        }

        const block: AssistantTextBlockState = {
          itemId: yield* Random.nextUUIDv4,
          blockIndex,
          emittedTextDelta: false,
          fallbackText: options?.fallbackText ?? "",
          streamClosed: options?.streamClosed ?? false,
          completionEmitted: false,
        };
        turnState.assistantTextBlocks.set(blockIndex, block);
        turnState.assistantTextBlockOrder.push(block);
        return { blockIndex, block };
      });

    const createSyntheticAssistantTextBlock = (
      context: ClaudeSessionContext,
      fallbackText: string,
    ): Effect.Effect<
      | {
          readonly blockIndex: number;
          readonly block: AssistantTextBlockState;
        }
      | undefined
    > =>
      Effect.gen(function* () {
        const turnState = context.turnState;
        if (!turnState) {
          return undefined;
        }

        const blockIndex = turnState.nextSyntheticAssistantBlockIndex;
        turnState.nextSyntheticAssistantBlockIndex -= 1;
        return yield* ensureAssistantTextBlock(context, blockIndex, {
          fallbackText,
          streamClosed: true,
        });
      });

    const completeAssistantTextBlock = (
      context: ClaudeSessionContext,
      block: AssistantTextBlockState,
      options?: {
        readonly force?: boolean;
        readonly rawMethod?: string;
        readonly rawPayload?: unknown;
      },
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const turnState = context.turnState;
        if (!turnState || block.completionEmitted) {
          return;
        }

        if (!options?.force && !block.streamClosed) {
          return;
        }

        if (!block.emittedTextDelta && block.fallbackText.length > 0) {
          const deltaStamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "content.delta",
            eventId: deltaStamp.eventId,
            provider: PROVIDER,
            createdAt: deltaStamp.createdAt,
            threadId: context.sessionKey,
            turnId: turnState.turnId,
            itemId: asRuntimeItemId(block.itemId),
            payload: {
              streamKind: "assistant_text",
              delta: block.fallbackText,
            },
            providerRefs: {
              ...providerThreadRef(context),
              providerTurnId: String(turnState.turnId),
            },
            ...(options?.rawMethod || options?.rawPayload
              ? {
                  raw: {
                    source: "claude.sdk.message" as const,
                    ...(options.rawMethod ? { method: options.rawMethod } : {}),
                    payload: options?.rawPayload,
                  },
                }
              : {}),
          });
        }

        block.completionEmitted = true;
        if (turnState.assistantTextBlocks.get(block.blockIndex) === block) {
          turnState.assistantTextBlocks.delete(block.blockIndex);
        }

        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "item.completed",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          itemId: asRuntimeItemId(block.itemId),
          threadId: context.sessionKey,
          turnId: turnState.turnId,
          payload: {
            itemType: "assistant_message",
            status: "completed",
            title: "Assistant message",
            ...(block.fallbackText.length > 0 ? { detail: block.fallbackText } : {}),
          },
          providerRefs: {
            ...providerThreadRef(context),
            providerTurnId: String(turnState.turnId),
          },
          ...(options?.rawMethod || options?.rawPayload
            ? {
                raw: {
                  source: "claude.sdk.message" as const,
                  ...(options.rawMethod ? { method: options.rawMethod } : {}),
                  payload: options?.rawPayload,
                },
              }
            : {}),
        });
      });

    const backfillAssistantTextBlocksFromSnapshot = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const turnState = context.turnState;
        if (!turnState) {
          return;
        }

        const snapshotTextBlocks = extractAssistantTextBlocks(message);
        if (snapshotTextBlocks.length === 0) {
          return;
        }

        const orderedBlocks = turnState.assistantTextBlockOrder.map((block) => ({
          blockIndex: block.blockIndex,
          block,
        }));

        for (const [position, text] of snapshotTextBlocks.entries()) {
          const existingEntry = orderedBlocks[position];
          const entry =
            existingEntry ??
            (yield* createSyntheticAssistantTextBlock(context, text).pipe(
              Effect.map((created) => {
                if (!created) {
                  return undefined;
                }
                orderedBlocks.push(created);
                return created;
              }),
            ));
          if (!entry) {
            continue;
          }

          if (entry.block.fallbackText.length === 0) {
            entry.block.fallbackText = text;
          }

          if (entry.block.streamClosed && !entry.block.completionEmitted) {
            yield* completeAssistantTextBlock(context, entry.block, {
              rawMethod: "claude/assistant",
              rawPayload: message,
            });
          }
        }
      });

    const completeTurn = (
      context: ClaudeSessionContext,
      status: ProviderRuntimeTurnStatus,
      errorMessage?: string,
      result?: SDKResultMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const turnState = context.turnState;
        if (!turnState) {
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "turn.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            payload: {
              state: status,
              ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
              ...(result?.usage ? { usage: result.usage } : {}),
              ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
              ...(typeof result?.total_cost_usd === "number"
                ? { totalCostUsd: result.total_cost_usd }
                : {}),
              ...(errorMessage ? { errorMessage } : {}),
            },
            providerRefs: {},
          });
          return;
        }

        for (const [index, tool] of context.inFlightTools.entries()) {
          const toolStamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "item.completed",
            eventId: toolStamp.eventId,
            provider: PROVIDER,
            createdAt: toolStamp.createdAt,
            threadId: context.sessionKey,
            turnId: turnState.turnId,
            itemId: asRuntimeItemId(tool.itemId),
            payload: {
              itemType: tool.itemType,
              status: status === "completed" ? "completed" : "failed",
              title: tool.title,
              ...(tool.detail ? { detail: tool.detail } : {}),
              data: {
                toolName: tool.toolName,
                input: tool.input,
              },
            },
            providerRefs: {
              ...providerThreadRef(context),
              providerTurnId: String(turnState.turnId),
              providerItemId: ProviderItemId.makeUnsafe(tool.itemId),
            },
            raw: {
              source: "claude.sdk.message",
              method: "claude/result",
              payload: result ?? { status },
            },
          });
          context.inFlightTools.delete(index);
        }
        context.inFlightTools.clear();

        for (const block of turnState.assistantTextBlockOrder) {
          yield* completeAssistantTextBlock(context, block, {
            force: true,
            rawMethod: "claude/result",
            rawPayload: result ?? { status },
          });
        }

        context.turns.push({
          id: turnState.turnId,
          items: [...turnState.items],
        });

        const stamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "turn.completed",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.sessionKey,
          turnId: turnState.turnId,
          payload: {
            state: status,
            ...(result?.stop_reason !== undefined ? { stopReason: result.stop_reason } : {}),
            ...(result?.usage ? { usage: result.usage } : {}),
            ...(result?.modelUsage ? { modelUsage: result.modelUsage } : {}),
            ...(typeof result?.total_cost_usd === "number"
              ? { totalCostUsd: result.total_cost_usd }
              : {}),
            ...(errorMessage ? { errorMessage } : {}),
          },
          providerRefs: {
            ...providerThreadRef(context),
            providerTurnId: turnState.turnId,
          },
        });

        const updatedAt = yield* nowIso;
        context.turnState = undefined;
        context.session = {
          ...context.session,
          status: "ready",
          activeTurnId: undefined,
          updatedAt,
          ...(status === "failed" && errorMessage ? { lastError: errorMessage } : {}),
        };
        yield* updateResumeCursor(context);
      });

    const handleStreamEvent = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (message.type !== "stream_event") {
          return;
        }

        const { event } = message;

        if (event.type === "content_block_delta") {
          if (
            event.delta.type === "text_delta" &&
            event.delta.text.length > 0 &&
            context.turnState
          ) {
            const assistantBlockEntry = yield* ensureAssistantTextBlock(context, event.index);
            if (assistantBlockEntry?.block) {
              assistantBlockEntry.block.emittedTextDelta = true;
            }
            const stamp = yield* makeEventStamp();
            yield* offerRuntimeEvent({
              type: "content.delta",
              eventId: stamp.eventId,
              provider: PROVIDER,
              createdAt: stamp.createdAt,
              threadId: context.sessionKey,
              turnId: context.turnState.turnId,
              ...(assistantBlockEntry?.block
                ? { itemId: asRuntimeItemId(assistantBlockEntry.block.itemId) }
                : {}),
              payload: {
                streamKind: streamKindFromDeltaType(event.delta.type),
                delta: event.delta.text,
              },
              providerRefs: {
                ...providerThreadRef(context),
                providerTurnId: String(context.turnState.turnId),
              },
              raw: {
                source: "claude.sdk.message",
                method: "claude/stream_event/content_block_delta",
                payload: message,
              },
            });
            return;
          }

          if (
            event.delta.type === "input_json_delta" &&
            typeof (event.delta as { partial_json?: string }).partial_json === "string"
          ) {
            const tool = context.inFlightTools.get(event.index);
            if (tool) {
              tool.inputJsonParts.push(
                (event.delta as { partial_json: string }).partial_json,
              );
              const parsedInput = parseAccumulatedToolInput(tool.inputJsonParts);
              if (Object.keys(parsedInput).length > 0) {
                tool.input = parsedInput;
              }
            }
          }
          return;
        }

        if (event.type === "content_block_start") {
          const { index, content_block: block } = event;
          if (block.type === "text") {
            yield* ensureAssistantTextBlock(context, index, {
              fallbackText: extractContentBlockText(block),
            });
            return;
          }
          if (
            block.type !== "tool_use" &&
            block.type !== "server_tool_use" &&
            block.type !== "mcp_tool_use"
          ) {
            return;
          }

          const toolName = block.name;
          const itemType = classifyToolItemType(toolName);
          const toolInput =
            typeof block.input === "object" && block.input !== null
              ? (block.input as Record<string, unknown>)
              : {};
          const itemId = block.id;
          const detail = summarizeToolRequest(toolName, toolInput);

          const tool: ToolInFlight = {
            itemId,
            itemType,
            toolName,
            title: titleForTool(itemType),
            detail,
            input: toolInput,
            inputJsonParts: [],
          };
          context.inFlightTools.set(index, tool);

          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "item.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            itemId: asRuntimeItemId(tool.itemId),
            payload: {
              itemType: tool.itemType,
              status: "inProgress",
              title: tool.title,
              ...(tool.detail ? { detail: tool.detail } : {}),
              data: {
                toolName: tool.toolName,
                input: toolInput,
              },
            },
            providerRefs: {
              ...providerThreadRef(context),
              ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
              providerItemId: ProviderItemId.makeUnsafe(tool.itemId),
            },
            raw: {
              source: "claude.sdk.message",
              method: "claude/stream_event/content_block_start",
              payload: message,
            },
          });
          return;
        }

        if (event.type === "content_block_stop") {
          const { index } = event;
          const assistantBlock = context.turnState?.assistantTextBlocks.get(index);
          if (assistantBlock) {
            assistantBlock.streamClosed = true;
            yield* completeAssistantTextBlock(context, assistantBlock, {
              rawMethod: "claude/stream_event/content_block_stop",
              rawPayload: message,
            });
            return;
          }

          const tool = context.inFlightTools.get(index);
          if (!tool) {
            return;
          }

          const resolvedInput = parseAccumulatedToolInput(tool.inputJsonParts);
          if (Object.keys(resolvedInput).length > 0) {
            tool.input = resolvedInput;
          }
        }
      });

    const handleUserMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (message.type !== "user") {
          return;
        }

        if (context.turnState) {
          context.turnState.items.push(message.message);
        }

        for (const toolResult of toolResultBlocksFromUserMessage(message)) {
          const toolEntry = Array.from(context.inFlightTools.entries()).find(
            ([, tool]) => tool.itemId === toolResult.toolUseId,
          );
          if (!toolEntry) {
            continue;
          }

          const [index, tool] = toolEntry;
          const itemStatus = toolResult.isError ? "failed" : "completed";
          const toolData = {
            toolName: tool.toolName,
            input: tool.input,
            result: toolResult.block,
          };

          const updatedStamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "item.updated",
            eventId: updatedStamp.eventId,
            provider: PROVIDER,
            createdAt: updatedStamp.createdAt,
            threadId: context.sessionKey,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            itemId: asRuntimeItemId(tool.itemId),
            payload: {
              itemType: tool.itemType,
              status: toolResult.isError ? "failed" : "inProgress",
              title: tool.title,
              ...(tool.detail ? { detail: tool.detail } : {}),
              data: toolData,
            },
            providerRefs: {
              ...providerThreadRef(context),
              ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
              providerItemId: ProviderItemId.makeUnsafe(tool.itemId),
            },
            raw: {
              source: "claude.sdk.message",
              method: "claude/user",
              payload: message,
            },
          });

          const streamKind = toolResultStreamKind(tool.itemType);
          if (streamKind && toolResult.text.length > 0 && context.turnState) {
            const deltaStamp = yield* makeEventStamp();
            yield* offerRuntimeEvent({
              type: "content.delta",
              eventId: deltaStamp.eventId,
              provider: PROVIDER,
              createdAt: deltaStamp.createdAt,
              threadId: context.sessionKey,
              turnId: context.turnState.turnId,
              itemId: asRuntimeItemId(tool.itemId),
              payload: {
                streamKind,
                delta: toolResult.text,
              },
              providerRefs: {
                ...providerThreadRef(context),
                providerTurnId: String(context.turnState.turnId),
                providerItemId: ProviderItemId.makeUnsafe(tool.itemId),
              },
              raw: {
                source: "claude.sdk.message",
                method: "claude/user",
                payload: message,
              },
            });
          }

          const completedStamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "item.completed",
            eventId: completedStamp.eventId,
            provider: PROVIDER,
            createdAt: completedStamp.createdAt,
            threadId: context.sessionKey,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            itemId: asRuntimeItemId(tool.itemId),
            payload: {
              itemType: tool.itemType,
              status: itemStatus,
              title: tool.title,
              ...(tool.detail ? { detail: tool.detail } : {}),
              data: toolData,
            },
            providerRefs: {
              ...providerThreadRef(context),
              ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
              providerItemId: ProviderItemId.makeUnsafe(tool.itemId),
            },
            raw: {
              source: "claude.sdk.message",
              method: "claude/user",
              payload: message,
            },
          });

          context.inFlightTools.delete(index);
        }
      });

    const handleAssistantMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (message.type !== "assistant") {
          return;
        }

        if (context.turnState) {
          context.turnState.items.push(message.message);
          yield* backfillAssistantTextBlocksFromSnapshot(context, message);
        }

        context.lastAssistantUuid = message.uuid;
        yield* updateResumeCursor(context);
      });

    const handleResultMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (message.type !== "result") {
          return;
        }

        const status = turnStatusFromResult(message);
        const errorMessage = message.subtype === "success" ? undefined : message.errors[0];

        if (status === "failed") {
          yield* emitRuntimeError(context, errorMessage ?? "Claude turn failed.");
        }

        yield* completeTurn(context, status, errorMessage, message);

        // Emit token usage from the result message's usage field
        const usage = (message as Record<string, unknown>).usage;
        if (
          usage &&
          typeof usage === "object" &&
          "input_tokens" in (usage as Record<string, unknown>)
        ) {
          const normalizedUsage = normalizeClaudeUsage(
            usage as {
              input_tokens: number;
              output_tokens: number;
              cache_creation_input_tokens: number;
              cache_read_input_tokens: number;
            },
          );
          const usageStamp = yield* makeEventStamp();
          const resultUsageEvent = {
            type: "thread.token-usage.updated" as const,
            eventId: usageStamp.eventId,
            provider: PROVIDER,
            createdAt: usageStamp.createdAt,
            threadId: context.sessionKey,
            payload: {
              usage: normalizedUsage,
              support: "derived-live" as const,
              source: "sdk-usage" as const,
            },
          };
          yield* offerRuntimeEvent(resultUsageEvent as ProviderRuntimeEvent);
        }
      });

    const handleSystemMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (message.type !== "system") {
          return;
        }

        const stamp = yield* makeEventStamp();
        const base = {
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.sessionKey,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          providerRefs: {
            ...providerThreadRef(context),
            ...(context.turnState ? { providerTurnId: context.turnState.turnId } : {}),
          },
          raw: {
            source: "claude.sdk.message" as const,
            method: sdkNativeMethod(message),
            messageType: `${message.type}:${message.subtype}`,
            payload: message,
          },
        };

        switch (message.subtype) {
          case "init":
            yield* offerRuntimeEvent({
              ...base,
              type: "session.configured",
              payload: {
                config: message as Record<string, unknown>,
              },
            });
            return;
          case "status":
            yield* offerRuntimeEvent({
              ...base,
              type: "session.state.changed",
              payload: {
                state: message.status === "compacting" ? "waiting" : "running",
                reason: `status:${message.status ?? "active"}`,
                detail: message,
              },
            });
            return;
          case "compact_boundary":
            yield* offerRuntimeEvent({
              ...base,
              type: "thread.state.changed",
              payload: {
                state: "compacted",
                detail: message,
              },
            });
            {
              const compactMeta = (message as Record<string, unknown>)
                .compact_metadata as
                | { pre_tokens?: number }
                | undefined;
              const compactUsageStamp = yield* makeEventStamp();
              const compactUsageEvent = {
                type: "thread.token-usage.updated" as const,
                eventId: compactUsageStamp.eventId,
                provider: PROVIDER,
                createdAt: compactUsageStamp.createdAt,
                threadId: context.sessionKey,
                ...(context.turnState
                  ? { turnId: asCanonicalTurnId(context.turnState.turnId) }
                  : {}),
                providerRefs: {
                  ...providerThreadRef(context),
                  ...(context.turnState
                    ? { providerTurnId: context.turnState.turnId }
                    : {}),
                },
                payload: {
                  usage: {
                    totalTokens: compactMeta?.pre_tokens ?? 0,
                  },
                  support: "derived-live" as const,
                  source: "compact-boundary" as const,
                },
              };
              yield* offerRuntimeEvent(compactUsageEvent as ProviderRuntimeEvent);
            }
            return;
          case "hook_started":
            yield* offerRuntimeEvent({
              ...base,
              type: "hook.started",
              payload: {
                hookId: message.hook_id,
                hookName: message.hook_name,
                hookEvent: message.hook_event,
              },
            });
            return;
          case "hook_progress":
            yield* offerRuntimeEvent({
              ...base,
              type: "hook.progress",
              payload: {
                hookId: message.hook_id,
                output: message.output,
                stdout: message.stdout,
                stderr: message.stderr,
              },
            });
            return;
          case "hook_response":
            yield* offerRuntimeEvent({
              ...base,
              type: "hook.completed",
              payload: {
                hookId: message.hook_id,
                outcome: message.outcome,
                output: message.output,
                stdout: message.stdout,
                stderr: message.stderr,
                ...(typeof message.exit_code === "number" ? { exitCode: message.exit_code } : {}),
              },
            });
            return;
          case "task_started":
            yield* offerRuntimeEvent({
              ...base,
              type: "task.started",
              payload: {
                taskId: RuntimeTaskId.makeUnsafe(message.task_id),
                description: message.description,
                ...(message.task_type ? { taskType: message.task_type } : {}),
              },
            });
            return;
          case "task_progress":
            yield* offerRuntimeEvent({
              ...base,
              type: "task.progress",
              payload: {
                taskId: RuntimeTaskId.makeUnsafe(message.task_id),
                description: message.description,
                ...(message.usage ? { usage: message.usage } : {}),
                ...(message.last_tool_name ? { lastToolName: message.last_tool_name } : {}),
                ...(() => {
                  const summary = (message as { summary?: unknown }).summary;
                  return typeof summary === "string" && summary.trim().length > 0
                    ? { summary }
                    : {};
                })(),
              },
            });
            return;
          case "task_notification":
            yield* offerRuntimeEvent({
              ...base,
              type: "task.completed",
              payload: {
                taskId: RuntimeTaskId.makeUnsafe(message.task_id),
                status: message.status,
                ...(message.summary ? { summary: message.summary } : {}),
                ...(message.usage ? { usage: message.usage } : {}),
              },
            });
            return;
          case "files_persisted":
            yield* offerRuntimeEvent({
              ...base,
              type: "files.persisted",
              payload: {
                files: Array.isArray(message.files)
                  ? message.files.map((file: { filename: string; file_id: string }) => ({
                      filename: file.filename,
                      fileId: file.file_id,
                    }))
                  : [],
                ...(Array.isArray(message.failed)
                  ? {
                      failed: message.failed.map((entry: { filename: string; error: string }) => ({
                        filename: entry.filename,
                        error: entry.error,
                      })),
                    }
                  : {}),
              },
            });
            return;
          default:
            yield* emitRuntimeWarning(
              context,
              `Unhandled Claude system message subtype '${message.subtype}'.`,
              message,
            );
            return;
        }
      });

    const handleSdkTelemetryMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const stamp = yield* makeEventStamp();
        const base = {
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.sessionKey,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          providerRefs: {
            ...providerThreadRef(context),
            ...(context.turnState ? { providerTurnId: context.turnState.turnId } : {}),
          },
          raw: {
            source: "claude.sdk.message" as const,
            method: sdkNativeMethod(message),
            messageType: message.type,
            payload: message,
          },
        };

        if (message.type === "tool_progress") {
          yield* offerRuntimeEvent({
            ...base,
            type: "tool.progress",
            payload: {
              toolUseId: message.tool_use_id,
              toolName: message.tool_name,
              elapsedSeconds: message.elapsed_time_seconds,
              ...(message.task_id ? { summary: `task:${message.task_id}` } : {}),
            },
          });
          return;
        }

        if (message.type === "tool_use_summary") {
          yield* offerRuntimeEvent({
            ...base,
            type: "tool.summary",
            payload: {
              summary: message.summary,
              ...(message.preceding_tool_use_ids.length > 0
                ? { precedingToolUseIds: message.preceding_tool_use_ids }
                : {}),
            },
          });
          return;
        }

        if (message.type === "auth_status") {
          yield* offerRuntimeEvent({
            ...base,
            type: "auth.status",
            payload: {
              isAuthenticating: message.isAuthenticating,
              output: message.output,
              ...(message.error ? { error: message.error } : {}),
            },
          });
          return;
        }

        if (message.type === "rate_limit_event") {
          yield* offerRuntimeEvent({
            ...base,
            type: "account.rate-limits.updated",
            payload: {
              rateLimits: message,
            },
          });
          return;
        }
      });

    const handleSdkMessage = (
      context: ClaudeSessionContext,
      message: SDKMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* logNativeSdkMessage(context, message);
        yield* ensureThreadId(context, message);

        switch (message.type) {
          case "stream_event":
            yield* handleStreamEvent(context, message);
            return;
          case "user":
            yield* handleUserMessage(context, message);
            return;
          case "assistant":
            yield* handleAssistantMessage(context, message);
            return;
          case "result":
            yield* handleResultMessage(context, message);
            return;
          case "system":
            yield* handleSystemMessage(context, message);
            return;
          case "tool_progress":
          case "tool_use_summary":
          case "auth_status":
          case "rate_limit_event":
            yield* handleSdkTelemetryMessage(context, message);
            return;
          default:
            yield* emitRuntimeWarning(
              context,
              `Unhandled Claude SDK message type '${message.type}'.`,
              message,
            );
            return;
        }
      });

    const runSdkStream = (context: ClaudeSessionContext): Effect.Effect<void, Error> =>
      Stream.fromAsyncIterable(context.query, (cause) =>
        toError(cause, "Claude runtime stream failed."),
      ).pipe(
        Stream.takeWhile(() => !context.stopped),
        Stream.runForEach((message) => handleSdkMessage(context, message)),
      );

    const handleStreamExit = (
      context: ClaudeSessionContext,
      exit: Exit.Exit<void, Error>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (context.stopped) {
          return;
        }

        if (Exit.isFailure(exit)) {
          if (isClaudeInterruptedCause(exit.cause)) {
            if (context.turnState) {
              yield* completeTurn(
                context,
                "interrupted",
                interruptionMessageFromClaudeCause(exit.cause),
              );
            }
          } else {
            const baseMessage = messageFromClaudeStreamCause(
              exit.cause,
              "Claude runtime stream failed.",
            );
            const detail = extractProcessErrorDetail(Cause.squash(exit.cause));
            const message = detail ? `${baseMessage} (${detail})` : baseMessage;
            yield* emitRuntimeError(context, message, Cause.pretty(exit.cause));
            yield* completeTurn(context, "failed", message);
          }
        } else if (context.turnState) {
          yield* completeTurn(context, "interrupted", "Claude runtime stream ended.");
        }

        yield* stopSessionInternal(context, {
          emitExitEvent: true,
        });
      });

    const stopSessionInternal = (
      context: ClaudeSessionContext,
      options?: { readonly emitExitEvent?: boolean },
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (context.stopped) return;

        context.stopped = true;

        for (const [requestId, pending] of context.pendingApprovals) {
          yield* Deferred.succeed(pending.decision, "cancel");
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "request.resolved",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            requestId: asRuntimeRequestId(requestId),
            payload: {
              requestType: pending.requestType,
              decision: "cancel",
            },
            providerRefs: {
              ...providerThreadRef(context),
              ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
              providerRequestId: requestId,
            },
          });
        }
        context.pendingApprovals.clear();

        for (const [requestId, pending] of context.pendingUserInputs) {
          yield* Deferred.succeed(pending.answers, {} as ProviderUserInputAnswers);
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "user-input.resolved",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            requestId: asRuntimeRequestId(requestId),
            payload: {
              answers: {},
            },
            providerRefs: {
              ...providerThreadRef(context),
              ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
            },
          });
        }
        context.pendingUserInputs.clear();

        if (context.turnState) {
          yield* completeTurn(context, "interrupted", "Session stopped.");
        }

        yield* Queue.shutdown(context.promptQueue);

        context.streamFiber = undefined;

        const closeExit = yield* Effect.exit(
          Effect.try({
            try: () => context.query.close(),
            catch: (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: context.sessionKey,
                detail: "Failed to close Claude runtime query.",
                cause,
              }),
          }),
        );
        if (Exit.isFailure(closeExit)) {
          yield* emitRuntimeError(
            context,
            "Failed to close Claude runtime query.",
            Cause.squash(closeExit.cause),
          );
        }

        const updatedAt = yield* nowIso;
        context.session = {
          ...context.session,
          status: "closed",
          activeTurnId: undefined,
          updatedAt,
        };

        if (options?.emitExitEvent !== false) {
          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "session.exited",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            payload: {
              reason: "Session stopped",
              exitKind: "graceful",
            },
            providerRefs: {},
          });
        }

        sessions.delete(context.sessionKey);
      });

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<ClaudeSessionContext, ProviderAdapterError> => {
      const context = sessions.get(threadId);
      if (!context) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      if (context.stopped || context.session.status === "closed") {
        return Effect.fail(
          new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      return Effect.succeed(context);
    };

    const startSession: ClaudeCodeAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          });
        }

        const startedAt = yield* nowIso;
        const resumeState = readClaudeResumeState(input.resumeCursor);
        const sessionKey = input.threadId;
        const threadId = resumeState?.threadId;

        const promptQueue = yield* Queue.unbounded<PromptQueueItem>();
        const prompt = promptQueueToAsyncIterable(promptQueue);

        const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
        const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
        const inFlightTools = new Map<number, ToolInFlight>();

        const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined);

        const canUseTool: CanUseTool = (toolName, toolInput, callbackOptions) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const context = yield* Ref.get(contextRef);
              if (!context) {
                return {
                  behavior: "deny",
                  message: "Claude session context is unavailable.",
                } satisfies PermissionResult;
              }

              if (toolName.toLowerCase() === "askuserquestion") {
                const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
                const rawQuestions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
                const questions = rawQuestions
                  .map((question, index) => {
                    if (!question || typeof question !== "object") {
                      return undefined;
                    }
                    const record = question as Record<string, unknown>;
                    const header =
                      typeof record.header === "string" && record.header.trim().length > 0
                        ? record.header.trim()
                        : `Question ${index + 1}`;
                    const prompt =
                      typeof record.question === "string" && record.question.trim().length > 0
                        ? record.question.trim()
                        : undefined;
                    if (!prompt) {
                      return undefined;
                    }
                    const options = Array.isArray(record.options)
                      ? record.options
                          .map((option) => {
                            if (!option || typeof option !== "object") {
                              return undefined;
                            }
                            const optionRecord = option as Record<string, unknown>;
                            const label =
                              typeof optionRecord.label === "string" &&
                              optionRecord.label.trim().length > 0
                                ? optionRecord.label.trim()
                                : undefined;
                            if (!label) {
                              return undefined;
                            }
                            return {
                              label,
                              description:
                                typeof optionRecord.description === "string"
                                  ? optionRecord.description
                                  : "",
                            };
                          })
                          .filter((option): option is { label: string; description: string } => option !== undefined)
                      : [];
                    return {
                      id: header,
                      header,
                      question: prompt,
                      options,
                    };
                  })
                  .filter(
                    (
                      question,
                    ): question is {
                      id: string;
                      header: string;
                      question: string;
                      options: Array<{ label: string; description: string }>;
                    } => question !== undefined,
                  );

                const answersDeferred = yield* Deferred.make<ProviderUserInputAnswers>();
                pendingUserInputs.set(requestId, {
                  answers: answersDeferred,
                });

                const requestedStamp = yield* makeEventStamp();
                yield* offerRuntimeEvent({
                  type: "user-input.requested",
                  eventId: requestedStamp.eventId,
                  provider: PROVIDER,
                  createdAt: requestedStamp.createdAt,
                  threadId: context.sessionKey,
                  ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
                  requestId: asRuntimeRequestId(requestId),
                  payload: {
                    questions,
                  },
                  providerRefs: {
                    ...providerThreadRef(context),
                    ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
                    ...(callbackOptions.toolUseID
                      ? { providerItemId: ProviderItemId.makeUnsafe(callbackOptions.toolUseID) }
                      : {}),
                  },
                  raw: {
                    source: "claude.sdk.permission",
                    method: "canUseTool/AskUserQuestion",
                    payload: {
                      toolName,
                      input: toolInput,
                    },
                  },
                });

                const onAbort = () => {
                  if (!pendingUserInputs.has(requestId)) {
                    return;
                  }
                  pendingUserInputs.delete(requestId);
                  Effect.runFork(Deferred.succeed(answersDeferred, {} as ProviderUserInputAnswers));
                };
                callbackOptions.signal.addEventListener("abort", onAbort, { once: true });

                const answers = yield* Deferred.await(answersDeferred);
                pendingUserInputs.delete(requestId);

                const resolvedStamp = yield* makeEventStamp();
                yield* offerRuntimeEvent({
                  type: "user-input.resolved",
                  eventId: resolvedStamp.eventId,
                  provider: PROVIDER,
                  createdAt: resolvedStamp.createdAt,
                  threadId: context.sessionKey,
                  ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
                  requestId: asRuntimeRequestId(requestId),
                  payload: {
                    answers,
                  },
                  providerRefs: {
                    ...providerThreadRef(context),
                    ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
                    ...(callbackOptions.toolUseID
                      ? { providerItemId: ProviderItemId.makeUnsafe(callbackOptions.toolUseID) }
                      : {}),
                  },
                  raw: {
                    source: "claude.sdk.permission",
                    method: "canUseTool/AskUserQuestion/resolved",
                    payload: { answers },
                  },
                });

                return {
                  behavior: "allow",
                  updatedInput: {
                    ...toolInput,
                    answers,
                  },
                } satisfies PermissionResult;
              }

              const runtimeMode = input.runtimeMode ?? "full-access";
              if (runtimeMode === "full-access") {
                return {
                  behavior: "allow",
                  updatedInput: toolInput,
                } satisfies PermissionResult;
              }

              const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4);
              const requestType = classifyRequestType(toolName);
              const detail = summarizeToolRequest(toolName, toolInput);
              const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>();
              const pendingApproval: PendingApproval = {
                requestType,
                detail,
                decision: decisionDeferred,
                ...(callbackOptions.suggestions
                  ? { suggestions: callbackOptions.suggestions }
                  : {}),
              };

              const requestedStamp = yield* makeEventStamp();
              yield* offerRuntimeEvent({
                type: "request.opened",
                eventId: requestedStamp.eventId,
                provider: PROVIDER,
                      createdAt: requestedStamp.createdAt,
                threadId: context.sessionKey,
                ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
                requestId: asRuntimeRequestId(requestId),
                payload: {
                  requestType,
                  detail,
                  args: {
                    toolName,
                    input: toolInput,
                    ...(callbackOptions.toolUseID ? { toolUseId: callbackOptions.toolUseID } : {}),
                  },
                },
                providerRefs: {
                      ...(context.session.threadId
                    ? { providerThreadId: context.session.threadId }
                    : {}),
                  ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
                  providerRequestId: requestId,
                },
                raw: {
                  source: "claude.sdk.permission",
                  method: "canUseTool/request",
                  payload: {
                    toolName,
                    input: toolInput,
                  },
                },
              });

              pendingApprovals.set(requestId, pendingApproval);

              const onAbort = () => {
                if (!pendingApprovals.has(requestId)) {
                  return;
                }
                pendingApprovals.delete(requestId);
                Effect.runFork(Deferred.succeed(decisionDeferred, "cancel"));
              };

              callbackOptions.signal.addEventListener("abort", onAbort, {
                once: true,
              });

              const decision = yield* Deferred.await(decisionDeferred);
              pendingApprovals.delete(requestId);

              const resolvedStamp = yield* makeEventStamp();
              yield* offerRuntimeEvent({
                type: "request.resolved",
                eventId: resolvedStamp.eventId,
                provider: PROVIDER,
                      createdAt: resolvedStamp.createdAt,
                threadId: context.sessionKey,
                ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
                requestId: asRuntimeRequestId(requestId),
                payload: {
                  requestType,
                  decision,
                },
                providerRefs: {
                      ...(context.session.threadId
                    ? { providerThreadId: context.session.threadId }
                    : {}),
                  ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
                  providerRequestId: requestId,
                },
                raw: {
                  source: "claude.sdk.permission",
                  method: "canUseTool/decision",
                  payload: {
                    decision,
                  },
                },
              });

              if (decision === "accept" || decision === "acceptForSession") {
                return {
                  behavior: "allow",
                  updatedInput: toolInput,
                  ...(decision === "acceptForSession" && pendingApproval.suggestions
                    ? { updatedPermissions: [...pendingApproval.suggestions] }
                    : {}),
                } satisfies PermissionResult;
              }

              return {
                behavior: "deny",
                message:
                  decision === "cancel"
                    ? "User cancelled tool execution."
                    : "User declined tool execution.",
              } satisfies PermissionResult;
            }),
          );

        const providerOptions = input.providerOptions?.claudeCode;
        const requestedEffort = resolveReasoningEffortForProvider(
          "claudeCode",
          input.modelOptions?.claudeCode?.effort ?? null,
          input.model,
        );
        const supportedEffortOptions = getReasoningEffortOptions("claudeCode", input.model);
        const effort =
          requestedEffort && supportedEffortOptions.includes(requestedEffort)
            ? requestedEffort
            : null;
        const fastMode =
          input.modelOptions?.claudeCode?.fastMode === true && supportsClaudeFastMode(input.model);
        const thinking =
          typeof input.modelOptions?.claudeCode?.thinking === "boolean" &&
          supportsClaudeThinkingToggle(input.model)
            ? input.modelOptions.claudeCode.thinking
            : undefined;
        const effectiveEffort = getEffectiveClaudeCodeEffort(effort);
        const permissionMode =
          toPermissionMode(providerOptions?.permissionMode) ??
          (input.runtimeMode === "full-access" ? "bypassPermissions" : undefined);
        const settings = {
          ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
          ...(fastMode ? { fastMode: true } : {}),
        };

        const queryOptions: ClaudeQueryOptions = {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(providerOptions?.binaryPath
            ? { pathToClaudeCodeExecutable: providerOptions.binaryPath }
            : {}),
          ...(effectiveEffort ? { effort: effectiveEffort } : {}),
          ...(permissionMode ? { permissionMode } : {}),
          ...(permissionMode === "bypassPermissions"
            ? { allowDangerouslySkipPermissions: true }
            : {}),
          ...(providerOptions?.maxThinkingTokens !== undefined
            ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
            : {}),
          ...(Object.keys(settings).length > 0 ? { settings } : {}),
          ...(resumeState?.resume ? { resume: resumeState.resume } : {}),
          ...(resumeState?.resumeSessionAt ? { resumeSessionAt: resumeState.resumeSessionAt } : {}),
          includePartialMessages: true,
          canUseTool,
          settingSources: [...CLAUDE_SETTING_SOURCES],
          strictMcpConfig: true,
          mcpServers: discoverClaudeCliMcpServers(input.cwd),
          tools: CLAUDE_CODE_PRESET,
          systemPrompt: CLAUDE_CODE_PRESET,
          env: sanitizedEnv(),
          spawnClaudeCodeProcess: createClaudeCodeProcessSpawner(),
          ...(input.cwd ? { additionalDirectories: [input.cwd] } : {}),
        };

        const queryRuntime = yield* Effect.try({
          try: () =>
            createQuery({
              prompt,
              options: queryOptions,
            }),
          catch: (cause) => {
            const baseDetail = toMessage(cause, "Failed to start Claude runtime session.");
            const processDetail = extractProcessErrorDetail(cause);
            const detail = processDetail ? `${baseDetail} (${processDetail})` : baseDetail;
            console.error(
              `[ClaudeCodeAdapter] Failed to start session for thread ${sessionKey}:`,
              baseDetail,
              processDetail ?? "(no extended detail)",
              cause,
            );
            return new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: sessionKey,
              detail,
              cause,
            });
          },
        });

        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(threadId ? { threadId } : {}),
          resumeCursor: {
            ...(threadId ? { threadId } : {}),
            ...(resumeState?.resume ? { resume: resumeState.resume } : {}),
            ...(resumeState?.resumeSessionAt
              ? { resumeSessionAt: resumeState.resumeSessionAt }
              : {}),
            turnCount: resumeState?.turnCount ?? 0,
          },
          createdAt: startedAt,
          updatedAt: startedAt,
        };

        const context: ClaudeSessionContext = {
          sessionKey,
          session,
          promptQueue,
          query: queryRuntime,
          streamFiber: undefined,
          startedAt,
          basePermissionMode: permissionMode,
          resumeSessionId: resumeState?.resume,
          pendingApprovals,
          pendingUserInputs,
          turns: [],
          inFlightTools,
          turnState: undefined,
          lastAssistantUuid: resumeState?.resumeSessionAt,
          lastThreadStartedId: undefined,
          stopped: false,
        };
        yield* Ref.set(contextRef, context);
        sessions.set(sessionKey, context);

        const sessionStartedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "session.started",
          eventId: sessionStartedStamp.eventId,
          provider: PROVIDER,
          createdAt: sessionStartedStamp.createdAt,
          threadId: sessionKey,
          payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
          providerRefs: {},
        });

        const configuredStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "session.configured",
          eventId: configuredStamp.eventId,
          provider: PROVIDER,
          createdAt: configuredStamp.createdAt,
          threadId: sessionKey,
          payload: {
            config: {
              ...(input.model ? { model: input.model } : {}),
              ...(input.cwd ? { cwd: input.cwd } : {}),
              ...(effectiveEffort ? { effort: effectiveEffort } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              ...(providerOptions?.maxThinkingTokens !== undefined
                ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
                : {}),
              ...(fastMode ? { fastMode: true } : {}),
              ...(typeof thinking === "boolean" ? { thinking } : {}),
            },
          },
          providerRefs: {},
        });

        const readyStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "session.state.changed",
          eventId: readyStamp.eventId,
          provider: PROVIDER,
          createdAt: readyStamp.createdAt,
          threadId: sessionKey,
          payload: {
            state: "ready",
          },
          providerRefs: {},
        });

        context.streamFiber = Effect.runFork(
          Effect.exit(runSdkStream(context)).pipe(
            Effect.flatMap((exit) => handleStreamExit(context, exit)),
          ),
        );

        return {
          ...session,
        };
      });

    const sendTurn: ClaudeCodeAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);

        if (context.turnState) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `Thread '${input.threadId}' already has an active turn '${context.turnState.turnId}'.`,
          });
        }

        if (input.model) {
          yield* Effect.tryPromise({
            try: () => context.query.setModel(input.model),
            catch: (cause) => toRequestError(input.threadId, "turn/setModel", cause),
          });
        }

        if (input.interactionMode === "plan") {
          yield* Effect.tryPromise({
            try: () => context.query.setPermissionMode("plan"),
            catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause),
          });
        } else if (input.interactionMode === "default") {
          yield* Effect.tryPromise({
            try: () =>
              context.query.setPermissionMode(context.basePermissionMode ?? "bypassPermissions"),
            catch: (cause) => toRequestError(input.threadId, "turn/setPermissionMode", cause),
          });
        }

        const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
        const turnState: ClaudeTurnState = {
          turnId,
          startedAt: yield* nowIso,
          items: [],
          assistantTextBlocks: new Map(),
          assistantTextBlockOrder: [],
          nextSyntheticAssistantBlockIndex: -1,
        };

        const updatedAt = yield* nowIso;
        context.turnState = turnState;
        context.session = {
          ...context.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt,
        };

        const turnStartedStamp = yield* makeEventStamp();
        yield* offerRuntimeEvent({
          type: "turn.started",
          eventId: turnStartedStamp.eventId,
          provider: PROVIDER,
          createdAt: turnStartedStamp.createdAt,
          threadId: context.sessionKey,
          turnId,
          payload: input.model ? { model: input.model } : {},
          providerRefs: {
            providerTurnId: String(turnId),
          },
        });

        const materializedImages =
          options?.stateDir && input.attachments && input.attachments.length > 0
            ? materializeImageAttachments({
                stateDir: options.stateDir,
                attachments: input.attachments,
              })
            : undefined;

        const materializedFiles =
          options?.stateDir && input.attachments && input.attachments.length > 0
            ? yield* Effect.tryPromise({
                try: () =>
                  materializeFileAttachments({
                    stateDir: options.stateDir!,
                    attachments: input.attachments!,
                  }),
                catch: () =>
                  new ProviderAdapterProcessError({
                    provider: PROVIDER,
                    threadId: input.threadId,
                    detail: "Failed to materialize file attachments.",
                  }),
              })
            : undefined;

        const message = buildUserMessage(input, materializedImages, materializedFiles);

        yield* Queue.offer(context.promptQueue, {
          type: "message",
          message,
        }).pipe(Effect.mapError((cause) => toRequestError(input.threadId, "turn/start", cause)));

        return {
          ...(context.session.threadId ? { threadId: context.session.threadId } : {}),
          turnId,
          ...(context.session.resumeCursor !== undefined
            ? { resumeCursor: context.session.resumeCursor }
            : {}),
        };
      });

    const interruptTurn: ClaudeCodeAdapterShape["interruptTurn"] = (threadId, _turnId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        yield* Effect.tryPromise({
          try: () => context.query.interrupt(),
          catch: (cause) => toRequestError(threadId, "turn/interrupt", cause),
        });
      });

    const readThread: ClaudeCodeAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        return yield* snapshotThread(context);
      });

    const rollbackThread: ClaudeCodeAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const nextLength = Math.max(0, context.turns.length - numTurns);
        context.turns.splice(nextLength);
        yield* updateResumeCursor(context);
        return yield* snapshotThread(context);
      });

    const respondToRequest: ClaudeCodeAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const pending = context.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "item/requestApproval/decision",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }

        context.pendingApprovals.delete(requestId);
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: ClaudeCodeAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        const pending = context.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "item/tool/respondToUserInput",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }

        context.pendingUserInputs.delete(requestId);
        yield* Deferred.succeed(pending.answers, answers);
      });

    const stopSession: ClaudeCodeAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        yield* stopSessionInternal(context, {
          emitExitEvent: true,
        });
      });

    const listSessions: ClaudeCodeAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), ({ session }) => ({ ...session })));

    const hasSession: ClaudeCodeAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });

    const stopAll: ClaudeCodeAdapterShape["stopAll"] = () =>
      Effect.forEach(
        sessions,
        ([, context]) =>
          stopSessionInternal(context, {
            emitExitEvent: true,
          }),
        { discard: true },
      );

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        sessions,
        ([, context]) =>
          stopSessionInternal(context, {
            emitExitEvent: false,
          }),
        { discard: true },
      ).pipe(Effect.tap(() => Queue.shutdown(runtimeEventQueue))),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies ClaudeCodeAdapterShape;
  });
}

export const ClaudeCodeAdapterLive = Layer.effect(ClaudeCodeAdapter, makeClaudeCodeAdapter());

export function makeClaudeCodeAdapterLive(options?: ClaudeCodeAdapterLiveOptions) {
  return Layer.effect(ClaudeCodeAdapter, makeClaudeCodeAdapter(options));
}
