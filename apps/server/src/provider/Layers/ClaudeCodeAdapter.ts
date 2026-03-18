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
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
} from "@xbetools/contracts";
import { Cause, DateTime, Deferred, Effect, Layer, Queue, Random, Ref, Stream } from "effect";

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
  readonly assistantItemId: string;
  readonly startedAt: string;
  readonly items: Array<unknown>;
  readonly messageCompleted: boolean;
  readonly emittedTextDelta: boolean;
  readonly fallbackAssistantText: string;
}

interface PendingApproval {
  readonly requestType: CanonicalRequestType;
  readonly detail?: string;
  readonly suggestions?: ReadonlyArray<PermissionUpdate>;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface ToolInFlight {
  readonly itemId: string;
  readonly itemType: CanonicalItemType;
  readonly toolName: string;
  readonly title: string;
  readonly detail?: string;
  /** Accumulated JSON fragments from `input_json_delta` events. */
  inputJsonParts: string[];
}

interface ClaudeSessionContext {
  /** Orchestrator's routing key — always set, used for Map/event routing. */
  readonly sessionKey: ThreadId;
  session: ProviderSession;
  readonly promptQueue: Queue.Queue<PromptQueueItem>;
  readonly query: ClaudeQueryRuntime;
  readonly startedAt: string;
  resumeSessionId: string | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
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
  return "dynamic_tool_call";
}

function classifyRequestType(toolName: string): CanonicalRequestType {
  const normalized = toolName.toLowerCase();
  if (normalized === "read" || normalized.includes("read file") || normalized.includes("view")) {
    return "file_read_approval";
  }
  return classifyToolItemType(toolName) === "command_execution"
    ? "command_execution_approval"
    : "file_change_approval";
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

/** MIME types that Claude supports natively as document content blocks. */
const CLAUDE_NATIVE_DOCUMENT_MIMES = new Set(["application/pdf"]);

function buildUserMessage(
  input: ProviderSendTurnInput,
  materializedImages?: MaterializedImageAttachment[],
  materializedFiles?: MaterializedFileAttachment[],
): SDKUserMessage {
  const content: Array<Record<string, unknown>> = [];

  const text = input.input?.trim() ?? "";
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

function turnStatusFromResult(result: SDKResultMessage): ProviderRuntimeTurnStatus {
  if (result.subtype === "success") {
    return "completed";
  }

  const errors = result.errors.join(" ").toLowerCase();
  if (errors.includes("interrupt")) {
    return "interrupted";
  }
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

function extractAssistantText(message: SDKMessage): string {
  if (message.type !== "assistant") {
    return "";
  }

  const content = (message.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return "";
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

  return fragments.join("");
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

        if (!turnState.messageCompleted) {
          if (!turnState.emittedTextDelta && turnState.fallbackAssistantText.length > 0) {
            const deltaStamp = yield* makeEventStamp();
            yield* offerRuntimeEvent({
              type: "content.delta",
              eventId: deltaStamp.eventId,
              provider: PROVIDER,
              createdAt: deltaStamp.createdAt,
              threadId: context.sessionKey,
              turnId: turnState.turnId,
              itemId: asRuntimeItemId(turnState.assistantItemId),
              payload: {
                streamKind: "assistant_text",
                delta: turnState.fallbackAssistantText,
              },
              providerRefs: {
                ...providerThreadRef(context),
                providerTurnId: String(turnState.turnId),
                providerItemId: ProviderItemId.makeUnsafe(turnState.assistantItemId),
              },
            });
          }

          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "item.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            itemId: asRuntimeItemId(turnState.assistantItemId),
            threadId: context.sessionKey,
            turnId: turnState.turnId,
            payload: {
              itemType: "assistant_message",
              status: "completed",
              title: "Assistant message",
            },
            providerRefs: {
              ...providerThreadRef(context),
              providerTurnId: turnState.turnId,
              providerItemId: ProviderItemId.makeUnsafe(turnState.assistantItemId),
            },
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
          // Accumulate tool input JSON fragments from streaming deltas.
          if (
            event.delta.type === "input_json_delta" &&
            typeof (event.delta as { partial_json?: string }).partial_json === "string"
          ) {
            const tool = context.inFlightTools.get(event.index);
            if (tool) {
              tool.inputJsonParts.push(
                (event.delta as { partial_json: string }).partial_json,
              );
            }
          }

          if (
            event.delta.type === "text_delta" &&
            event.delta.text.length > 0 &&
            context.turnState
          ) {
            if (!context.turnState.emittedTextDelta) {
              context.turnState = {
                ...context.turnState,
                emittedTextDelta: true,
              };
            }
            const stamp = yield* makeEventStamp();
            yield* offerRuntimeEvent({
              type: "content.delta",
              eventId: stamp.eventId,
              provider: PROVIDER,
              createdAt: stamp.createdAt,
              threadId: context.sessionKey,
              turnId: context.turnState.turnId,
              itemId: asRuntimeItemId(context.turnState.assistantItemId),
              payload: {
                streamKind: streamKindFromDeltaType(event.delta.type),
                delta: event.delta.text,
              },
              providerRefs: {
                ...providerThreadRef(context),
                providerTurnId: context.turnState.turnId,
                providerItemId: ProviderItemId.makeUnsafe(context.turnState.assistantItemId),
              },
              raw: {
                source: "claude.sdk.message",
                method: "claude/stream_event/content_block_delta",
                payload: message,
              },
            });
          }
          return;
        }

        if (event.type === "content_block_start") {
          const { index, content_block: block } = event;
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
          const tool = context.inFlightTools.get(index);
          if (!tool) {
            return;
          }
          context.inFlightTools.delete(index);

          // Rebuild tool input from accumulated JSON delta fragments.
          const resolvedInput = parseAccumulatedToolInput(tool.inputJsonParts);
          const resolvedDetail =
            Object.keys(resolvedInput).length > 0
              ? summarizeToolRequest(tool.toolName, resolvedInput)
              : tool.detail;

          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "item.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
              createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
            itemId: asRuntimeItemId(tool.itemId),
            payload: {
              itemType: tool.itemType,
              status: "completed",
              title: tool.title,
              ...(resolvedDetail ? { detail: resolvedDetail } : {}),
              data: {
                toolName: tool.toolName,
                input: resolvedInput,
              },
            },
            providerRefs: {
              ...providerThreadRef(context),
              ...(context.turnState ? { providerTurnId: String(context.turnState.turnId) } : {}),
              providerItemId: ProviderItemId.makeUnsafe(tool.itemId),
            },
            raw: {
              source: "claude.sdk.message",
              method: "claude/stream_event/content_block_stop",
              payload: message,
            },
          });
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
          const fallbackAssistantText = extractAssistantText(message);
          if (
            fallbackAssistantText.length > 0 &&
            fallbackAssistantText !== context.turnState.fallbackAssistantText
          ) {
            context.turnState = {
              ...context.turnState,
              fallbackAssistantText,
            };
          }

          const stamp = yield* makeEventStamp();
          yield* offerRuntimeEvent({
            type: "item.updated",
            eventId: stamp.eventId,
            provider: PROVIDER,
            createdAt: stamp.createdAt,
            threadId: context.sessionKey,
            turnId: context.turnState.turnId,
            itemId: asRuntimeItemId(context.turnState.assistantItemId),
            payload: {
              itemType: "assistant_message",
              status: "inProgress",
              title: "Assistant message",
              data: message.message,
            },
            providerRefs: {
              ...providerThreadRef(context),
              providerTurnId: context.turnState.turnId,
              providerItemId: ProviderItemId.makeUnsafe(context.turnState.assistantItemId),
            },
            raw: {
              source: "claude.sdk.message",
              method: "claude/assistant",
              payload: message,
            },
          });
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

    const runSdkStream = (context: ClaudeSessionContext): Effect.Effect<void> =>
      Stream.fromAsyncIterable(context.query, (cause) => cause).pipe(
        Stream.takeWhile(() => !context.stopped),
        Stream.runForEach((message) => handleSdkMessage(context, message)),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.hasInterruptsOnly(cause) || context.stopped) {
              return;
            }
            const squashed = Cause.squash(cause);
            const baseMessage = toMessage(squashed, "Claude runtime stream failed.");
            const detail = extractProcessErrorDetail(squashed);
            const message = detail ? `${baseMessage} (${detail})` : baseMessage;
            console.error(
              `[ClaudeCodeAdapter] Stream error for thread ${context.sessionKey}:`,
              baseMessage,
              detail ?? "(no extended detail)",
              squashed,
            );
            yield* emitRuntimeError(context, message, cause);
            yield* completeTurn(context, "failed", message);
          }),
        ),
      );

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

        if (context.turnState) {
          yield* completeTurn(context, "interrupted", "Session stopped.");
        }

        yield* Queue.shutdown(context.promptQueue);

        context.query.close();

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
        const prompt = Stream.fromQueue(promptQueue).pipe(
          Stream.filter((item) => item.type === "message"),
          Stream.map((item) => item.message),
          Stream.toAsyncIterable,
        );

        const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
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
        const permissionMode =
          toPermissionMode(providerOptions?.permissionMode) ??
          (input.runtimeMode === "full-access" ? "bypassPermissions" : undefined);

        const queryOptions: ClaudeQueryOptions = {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(providerOptions?.binaryPath
            ? { pathToClaudeCodeExecutable: providerOptions.binaryPath }
            : {}),
          ...(permissionMode ? { permissionMode } : {}),
          ...(permissionMode === "bypassPermissions"
            ? { allowDangerouslySkipPermissions: true }
            : {}),
          ...(providerOptions?.maxThinkingTokens !== undefined
            ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
            : {}),
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
          startedAt,
          resumeSessionId: resumeState?.resume,
          pendingApprovals,
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
              ...(permissionMode ? { permissionMode } : {}),
              ...(providerOptions?.maxThinkingTokens !== undefined
                ? { maxThinkingTokens: providerOptions.maxThinkingTokens }
                : {}),
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

        Effect.runFork(
          runSdkStream(context).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                console.error(
                  `[ClaudeCodeAdapter] Unhandled SDK stream fiber failure for thread ${context.sessionKey}:`,
                  cause,
                );
              }),
            ),
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

        const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
        const turnState: ClaudeTurnState = {
          turnId,
          assistantItemId: yield* Random.nextUUIDv4,
          startedAt: yield* nowIso,
          items: [],
          messageCompleted: false,
          emittedTextDelta: false,
          fallbackAssistantText: "",
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
      _answers,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "item/tool/requestUserInput",
          detail: `Claude Code does not yet support structured user-input responses for thread '${threadId}' and request '${requestId}'.`,
        }),
      );

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
