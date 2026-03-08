/**
 * GeminiAdapterLive - Scoped live implementation for the Gemini provider adapter.
 *
 * Wraps `@google/genai` SDK behind the generic provider adapter contract and
 * emits canonical runtime events. Gemini v1 is an assistant-only provider — it
 * does not execute tools. Function calling support may be added in a future
 * iteration.
 *
 * @module GeminiAdapterLive
 */
import { GoogleGenAI, type Chat, type GenerateContentConfig } from "@google/genai";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSendTurnInput,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@xbetools/contracts";
import { Cause, DateTime, Effect, Layer, Queue, Random, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { GeminiAdapter, type GeminiAdapterShape } from "../Services/GeminiAdapter.ts";

const PROVIDER = "gemini" as const;

interface GeminiTurnState {
  readonly turnId: TurnId;
  readonly assistantItemId: string;
  readonly startedAt: string;
  emittedTextDelta: boolean;
  accumulatedText: string;
}

/**
 * Mutable session state. ProviderSession from contracts is readonly; we keep
 * a mutable copy here and spread it when returning to callers.
 */
interface MutableSession {
  provider: ProviderSession["provider"];
  status: ProviderSession["status"];
  runtimeMode: ProviderSession["runtimeMode"];
  cwd: ProviderSession["cwd"];
  model: ProviderSession["model"];
  threadId: ProviderSession["threadId"];
  resumeCursor: unknown;
  activeTurnId: ProviderSession["activeTurnId"];
  createdAt: ProviderSession["createdAt"];
  updatedAt: ProviderSession["updatedAt"];
  lastError?: string;
}

function toProviderSession(s: MutableSession): ProviderSession {
  return { ...s } as ProviderSession;
}

/** Persisted conversation turn for session recovery. */
interface PersistedTurn {
  id: TurnId;
  userMessage: string;
  providerMessage: string | undefined;
  assistantText: string;
}

interface GeminiSessionContext {
  session: MutableSession;
  chat: Chat;
  readonly ai: GoogleGenAI;
  readonly model: string;
  readonly config: GenerateContentConfig;
  readonly projectContext: string | undefined;
  readonly startedAt: string;
  readonly turns: PersistedTurn[];
  readonly abortControllers: Set<AbortController>;
  turnState: GeminiTurnState | undefined;
  stopped: boolean;
}

export interface GeminiAdapterLiveOptions {
  readonly apiKey?: string;
}

function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function isAbortError(cause: unknown): boolean {
  if (cause instanceof DOMException && cause.name === "AbortError") return true;
  if (cause instanceof Error && cause.name === "AbortError") return true;
  if (cause instanceof Error && cause.message.includes("aborted")) return true;
  return false;
}

interface GeminiResumeState {
  threadId?: string;
  model?: string;
  turnCount?: number;
  turns?: ReadonlyArray<{
    userMessage: string;
    providerMessage?: string;
    assistantText: string;
  }>;
}

function readGeminiResumeState(resumeCursor: unknown): GeminiResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const cursor = resumeCursor as Record<string, unknown>;
  const out: GeminiResumeState = {};
  if (typeof cursor.threadId === "string") out.threadId = cursor.threadId;
  if (typeof cursor.model === "string") out.model = cursor.model;
  if (typeof cursor.turnCount === "number") out.turnCount = cursor.turnCount;
  if (Array.isArray(cursor.turns)) {
    out.turns = cursor.turns.filter(
      (
        t,
      ): t is {
        userMessage: string;
        providerMessage?: string;
        assistantText: string;
      } =>
        t !== null &&
        typeof t === "object" &&
        typeof (t as Record<string, unknown>).userMessage === "string" &&
        (!("providerMessage" in (t as Record<string, unknown>)) ||
          typeof (t as Record<string, unknown>).providerMessage === "string") &&
        typeof (t as Record<string, unknown>).assistantText === "string",
    );
  }
  return out;
}

function resolveApiKey(
  layerOptions?: GeminiAdapterLiveOptions,
  sessionApiKey?: string,
): string | undefined {
  return (
    sessionApiKey ?? layerOptions?.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  );
}

function buildResumeCursor(ctx: GeminiSessionContext) {
  return {
    threadId: ctx.session.threadId,
    model: ctx.model,
    turnCount: ctx.turns.length,
    turns: ctx.turns.map((t) => ({
      userMessage: t.userMessage,
      ...(t.providerMessage ? { providerMessage: t.providerMessage } : {}),
      assistantText: t.assistantText,
    })),
  };
}

/**
 * Create a fresh Gemini chat, optionally replaying prior turns
 * to reconstruct context after recovery or rollback.
 */
function createChat(
  ai: GoogleGenAI,
  model: string,
  config: GenerateContentConfig,
  history?: ReadonlyArray<{
    userMessage: string;
    providerMessage?: string;
    assistantText: string;
  }>,
): Chat {
  const chatHistory =
    history && history.length > 0
      ? history.flatMap((turn) => [
          {
            role: "user" as const,
            parts: [{ text: turn.providerMessage ?? turn.userMessage }],
          },
          { role: "model" as const, parts: [{ text: turn.assistantText }] },
        ])
      : undefined;

  return ai.chats.create({
    model,
    config,
    ...(chatHistory ? { history: chatHistory } : {}),
  });
}

export function makeGeminiAdapter(options?: GeminiAdapterLiveOptions) {
  return Effect.gen(function* () {
    const sessions = new Map<ThreadId, GeminiSessionContext>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.makeUnsafe(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

    const emit = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<GeminiSessionContext, ProviderAdapterError> =>
      Effect.gen(function* () {
        const ctx = sessions.get(threadId);
        if (!ctx) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        if (ctx.stopped) {
          return yield* new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId,
          });
        }
        return ctx;
      });

    // ── Internal helpers ─────────────────────────────────────────────

    const completeTurn = (
      ctx: GeminiSessionContext,
      status: "completed" | "failed" | "interrupted",
      errorMessage?: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const ts = ctx.turnState;
        if (!ts) return;

        // Emit fallback text if no streaming delta was sent yet
        if (!ts.emittedTextDelta && ts.accumulatedText.length > 0) {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "content.delta",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId: ctx.session.threadId,
            createdAt: stamp.createdAt,
            turnId: ts.turnId,
            itemId: RuntimeItemId.makeUnsafe(ts.assistantItemId),
            payload: { streamKind: "assistant_text", delta: ts.accumulatedText },
          });
        }

        // Complete the assistant message item
        {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "item.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId: ctx.session.threadId,
            createdAt: stamp.createdAt,
            turnId: ts.turnId,
            itemId: RuntimeItemId.makeUnsafe(ts.assistantItemId),
            payload: {
              itemType: "assistant_message",
              status: status === "completed" ? "completed" : "failed",
            },
          });
        }

        ctx.turnState = undefined;

        // Emit turn.completed
        {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "turn.completed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId: ctx.session.threadId,
            createdAt: stamp.createdAt,
            turnId: ts.turnId,
            payload: {
              state: status,
              ...(errorMessage ? { errorMessage } : {}),
            },
          });
        }

        // Reset session state
        ctx.session.status = "ready";
        ctx.session.activeTurnId = undefined;
        ctx.session.resumeCursor = buildResumeCursor(ctx);
        ctx.session.updatedAt = yield* nowIso;
      });

    const stopSessionInternal = (
      ctx: GeminiSessionContext,
      opts: { emitExitEvent: boolean },
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;

        // Abort any in-flight requests
        for (const controller of ctx.abortControllers) {
          controller.abort();
        }
        ctx.abortControllers.clear();

        // Complete active turn if any
        if (ctx.turnState) {
          yield* completeTurn(ctx, "interrupted");
        }

        ctx.session.status = "closed";
        sessions.delete(ctx.session.threadId);

        if (opts.emitExitEvent) {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "session.exited",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId: ctx.session.threadId,
            createdAt: stamp.createdAt,
            payload: { reason: "stopped", recoverable: false, exitKind: "graceful" },
          });
        }
      });

    const streamGeminiResponse = (
      ctx: GeminiSessionContext,
      userMessage: string,
      providerMessage: string,
    ): Effect.Effect<void, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        const ts = ctx.turnState;
        if (!ts) return;

        const abortController = new AbortController();
        ctx.abortControllers.add(abortController);

        const cleanup = () => ctx.abortControllers.delete(abortController);

        const response = yield* Effect.tryPromise({
          try: () =>
            ctx.chat.sendMessageStream({
              message: providerMessage,
              config: {
                ...ctx.config,
                abortSignal: abortController.signal,
              },
            }),
          catch: (cause) => {
            cleanup();
            if (isAbortError(cause)) {
              return new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "chat/sendMessageStream",
                detail: "aborted",
              });
            }
            return new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "chat/sendMessageStream",
              detail: toMessage(cause, "Failed to start Gemini stream"),
            });
          },
        });

        // Consume async iterator chunk by chunk
        const iterator = response[Symbol.asyncIterator]();
        let done = false;
        while (!done && !ctx.stopped) {
          const next = yield* Effect.tryPromise({
            try: () => iterator.next(),
            catch: (cause) => {
              cleanup();
              if (isAbortError(cause)) {
                return new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "chat/stream-chunk",
                  detail: "aborted",
                });
              }
              return new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "chat/stream-chunk",
                detail: toMessage(cause, "Gemini stream error"),
              });
            },
          });

          if (next.done) {
            done = true;
            break;
          }

          const text = next.value.text ?? "";
          if (text.length > 0) {
            ts.accumulatedText += text;
            ts.emittedTextDelta = true;

            const stamp = yield* makeEventStamp();
            yield* emit({
              type: "content.delta",
              eventId: stamp.eventId,
              provider: PROVIDER,
              threadId: ctx.session.threadId,
              createdAt: stamp.createdAt,
              turnId: ts.turnId,
              itemId: RuntimeItemId.makeUnsafe(ts.assistantItemId),
              payload: { streamKind: "assistant_text", delta: text },
            });
          }
        }

        cleanup();

        if (!ctx.stopped) {
          // Record turn in transcript before completing
          ctx.turns.push({
            id: ts.turnId,
            userMessage,
            providerMessage,
            assistantText: ts.accumulatedText,
          });
          yield* completeTurn(ctx, "completed");
        }
      });

    // ── Adapter Methods ──────────────────────────────────────────────

    const startSession: GeminiAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        const threadId = input.threadId;
        if (input.provider && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}', got '${input.provider}'.`,
          });
        }

        const sessionApiKey = input.providerOptions?.gemini?.apiKey;
        const apiKey = resolveApiKey(options, sessionApiKey);
        if (!apiKey) {
          return yield* new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail:
              "No Gemini API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.",
          });
        }

        const resumeState = readGeminiResumeState(input.resumeCursor);
        const model =
          input.model ?? resumeState?.model ?? DEFAULT_MODEL_BY_PROVIDER.gemini;

        const projectContext = input.cwd ? gatherProjectContext(input.cwd) : undefined;
        const systemInstruction = buildSystemInstruction(input.cwd, projectContext);
        const config: GenerateContentConfig = systemInstruction
          ? { systemInstruction }
          : {};

        const ai = new GoogleGenAI({ apiKey });

        // Replay prior turns if resuming to reconstruct conversation context
        const priorTurns = resumeState?.turns;
        const chat = createChat(ai, model, config, priorTurns);

        const now = yield* nowIso;

        // Restore persisted turn history
        const restoredTurns: PersistedTurn[] = (priorTurns ?? []).map((t, i) => ({
          id: TurnId.makeUnsafe(`restored-${i}`),
          userMessage: t.userMessage,
          providerMessage: t.providerMessage,
          assistantText: t.assistantText,
        }));

        const session: MutableSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: input.cwd,
          model,
          threadId,
          resumeCursor: {
            threadId,
            model,
            turnCount: restoredTurns.length,
            turns: restoredTurns.map((t) => ({
              userMessage: t.userMessage,
              ...(t.providerMessage ? { providerMessage: t.providerMessage } : {}),
              assistantText: t.assistantText,
            })),
          },
          activeTurnId: undefined,
          createdAt: now,
          updatedAt: now,
        };

        const ctx: GeminiSessionContext = {
          session,
          chat,
          ai,
          model,
          config,
          projectContext,
          startedAt: now,
          turns: restoredTurns,
          abortControllers: new Set(),
          turnState: undefined,
          stopped: false,
        };
        sessions.set(threadId, ctx);

        {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "session.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            payload: {},
          });
        }
        {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "session.configured",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            payload: { config: { model } },
          });
        }
        {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "session.state.changed",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            payload: { state: "ready" },
          });
        }

        return toProviderSession(session);
      });

    const sendTurn: GeminiAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);

        if (ctx.turnState) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/send",
            detail: `A turn is already in progress for thread '${input.threadId}'.`,
          });
        }

        const turnId = TurnId.makeUnsafe(yield* Random.nextUUIDv4);
        const assistantItemId = yield* Random.nextUUIDv4;
        const now = yield* nowIso;

        ctx.turnState = {
          turnId,
          assistantItemId,
          startedAt: now,
          emittedTextDelta: false,
          accumulatedText: "",
        };
        ctx.session.status = "running";
        ctx.session.activeTurnId = turnId;
        ctx.session.updatedAt = now;

        {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "turn.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId: input.threadId,
            createdAt: stamp.createdAt,
            turnId,
            payload: { model: ctx.model },
          });
        }
        {
          const stamp = yield* makeEventStamp();
          yield* emit({
            type: "item.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId: input.threadId,
            createdAt: stamp.createdAt,
            turnId,
            itemId: RuntimeItemId.makeUnsafe(assistantItemId),
            payload: { itemType: "assistant_message" },
          });
        }

        const userMessage = buildUserMessage(input);
        const providerMessage = buildProviderMessage(userMessage, {
          cwd: ctx.session.cwd,
          projectContext: ctx.projectContext,
        });
        const threadId = input.threadId;

        // Stream response in background (non-blocking), matching ClaudeCodeAdapter pattern
        Effect.runFork(
          streamGeminiResponse(ctx, userMessage, providerMessage).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                if (Cause.hasInterruptsOnly(cause) || ctx.stopped) return;

                const squashed = Cause.squash(cause);

                // Abort errors are interrupts, not failures
                if (isAbortError(squashed)) {
                  yield* completeTurn(ctx, "interrupted");
                  return;
                }

                const msg = toMessage(squashed, "Gemini stream failed");

                // Check if the error detail indicates abort
                if (
                  squashed &&
                  typeof squashed === "object" &&
                  "detail" in squashed &&
                  (squashed as { detail: string }).detail === "aborted"
                ) {
                  yield* completeTurn(ctx, "interrupted");
                  return;
                }

                const stamp = yield* makeEventStamp();
                yield* emit({
                  type: "runtime.error",
                  eventId: stamp.eventId,
                  provider: PROVIDER,
                  threadId,
                  createdAt: stamp.createdAt,
                  turnId,
                  payload: { message: msg, class: "provider_error" },
                });
                yield* completeTurn(ctx, "failed", msg);
              }),
            ),
          ),
        );

        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: ctx.session.resumeCursor,
        };
      });

    const interruptTurn: GeminiAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        for (const controller of ctx.abortControllers) {
          controller.abort();
        }
        ctx.abortControllers.clear();
      });

    const readThread: GeminiAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return {
          threadId,
          turns: ctx.turns.map((turn) => ({
            id: turn.id,
            items: [{ type: "assistant_message" as const, text: turn.assistantText }],
          })),
        };
      });

    const rollbackThread: GeminiAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const removeCount = Math.min(numTurns, ctx.turns.length);
        ctx.turns.splice(ctx.turns.length - removeCount, removeCount);

        // Rebuild chat with remaining turns so SDK state matches local state
        ctx.chat = createChat(
          ctx.ai,
          ctx.model,
          ctx.config,
          ctx.turns.map((t) => ({
            userMessage: t.userMessage,
            ...(t.providerMessage ? { providerMessage: t.providerMessage } : {}),
            assistantText: t.assistantText,
          })),
        );

        ctx.session.resumeCursor = buildResumeCursor(ctx);

        return {
          threadId,
          turns: ctx.turns.map((turn) => ({
            id: turn.id,
            items: [{ type: "assistant_message" as const, text: turn.assistantText }],
          })),
        };
      });

    const respondToRequest: GeminiAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      _decision,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "respondToRequest",
          detail: `Gemini adapter does not support approval requests (thread '${threadId}', request '${requestId}').`,
        }),
      );

    const respondToUserInput: GeminiAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      _answers,
    ) =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "respondToUserInput",
          detail: `Gemini adapter does not support user-input responses (thread '${threadId}', request '${requestId}').`,
        }),
      );

    const stopSession: GeminiAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* stopSessionInternal(ctx, { emitExitEvent: true });
      });

    const listSessions: GeminiAdapterShape["listSessions"] = () =>
      Effect.sync(() =>
        Array.from(sessions.values(), ({ session }) => toProviderSession(session)),
      );

    const hasSession: GeminiAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const ctx = sessions.get(threadId);
        return ctx !== undefined && !ctx.stopped;
      });

    const stopAll: GeminiAdapterShape["stopAll"] = () =>
      Effect.forEach(
        sessions,
        ([, ctx]) => stopSessionInternal(ctx, { emitExitEvent: true }),
        { discard: true },
      );

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        sessions,
        ([, ctx]) => stopSessionInternal(ctx, { emitExitEvent: false }),
        { discard: true },
      ).pipe(Effect.tap(() => Queue.shutdown(runtimeEventQueue))),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "restart-session" },
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
    } satisfies GeminiAdapterShape;
  });
}

function gatherProjectContext(cwd: string): string {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const sections: string[] = [];
  const summarizePackageManifest = (packageJsonPath: string): string | undefined => {
    try {
      if (!fs.existsSync(packageJsonPath)) return undefined;
      const raw = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
        name?: unknown;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        packageManager?: unknown;
      };
      const relativePath = path.relative(cwd, packageJsonPath) || "package.json";
      const scripts = Object.keys(raw.scripts ?? {}).slice(0, 8);
      const dependencies = Object.keys({
        ...raw.dependencies,
        ...raw.devDependencies,
      }).slice(0, 18);

      return [
        `Manifest: ${relativePath}`,
        ...(typeof raw.name === "string" ? [`name: ${raw.name}`] : []),
        ...(typeof raw.packageManager === "string"
          ? [`packageManager: ${raw.packageManager}`]
          : []),
        ...(scripts.length > 0 ? [`scripts: ${scripts.join(", ")}`] : []),
        ...(dependencies.length > 0 ? [`key deps: ${dependencies.join(", ")}`] : []),
      ].join("\n");
    } catch {
      return undefined;
    }
  };

  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .toSorted();
    sections.push(`Directory listing of ${cwd}:\n${items.join("\n")}`);
  } catch {
    // ignore
  }

  const manifestSummaries: string[] = [];
  const rootManifest = summarizePackageManifest(path.join(cwd, "package.json"));
  if (rootManifest) {
    manifestSummaries.push(rootManifest);
  }

  for (const workspaceDir of ["apps", "packages"]) {
    const workspaceRoot = path.join(cwd, workspaceDir);
    try {
      if (!fs.existsSync(workspaceRoot)) continue;
      const entries = fs
        .readdirSync(workspaceRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted();

      for (const entry of entries) {
        const summary = summarizePackageManifest(
          path.join(workspaceRoot, entry, "package.json"),
        );
        if (summary) {
          manifestSummaries.push(summary);
        }
      }
    } catch {
      // ignore
    }
  }

  if (manifestSummaries.length > 0) {
    sections.push(manifestSummaries.join("\n\n"));
  }

  // Include README snippet if present
  for (const readme of ["README.md", "readme.md", "README.txt"]) {
    const readmePath = path.join(cwd, readme);
    try {
      if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, "utf-8").slice(0, 2000);
        sections.push(`Contents of ${readme} (truncated):\n${content}`);
        break;
      }
    } catch {
      // ignore
    }
  }

  return sections.join("\n\n");
}

function buildSystemInstruction(cwd?: string, projectContext?: string): string | undefined {
  if (!cwd || !projectContext) return undefined;

  return [
    "You are an expert coding assistant for the user's current repository.",
    "The project context below was loaded from disk on the server for this exact workspace.",
    "Do not say you cannot access the files or codebase when the answer can be derived from that context.",
    `The user's project is located at: ${cwd}`,
    "Answer questions about the project's stack, architecture, and code using the provided context.",
    "Ask for more files only if the provided context is genuinely insufficient.",
    "",
    "## Project Context (loaded from disk)",
    projectContext,
  ].join("\n");
}

function buildUserMessage(input: ProviderSendTurnInput): string {
  const parts: string[] = [];
  if (input.input) {
    parts.push(input.input);
  }
  if (input.attachments && input.attachments.length > 0) {
    for (const attachment of input.attachments) {
      if (attachment.name) {
        parts.push(`[Attachment: ${attachment.name} (${attachment.mimeType})]`);
      }
    }
  }
  return parts.join("\n\n") || "Continue.";
}

function buildProviderMessage(
  userMessage: string,
  options: {
    cwd: string | undefined;
    projectContext: string | undefined;
  },
): string {
  if (!options.cwd || !options.projectContext) {
    return userMessage;
  }

  return [
    "The following project context was loaded from disk for the current repository.",
    "Treat it as authoritative local context for this answer.",
    "If the question can be answered from this context, answer directly.",
    "Do not claim that you cannot access the files or codebase when this context is sufficient.",
    "",
    "<project_context>",
    options.projectContext,
    "</project_context>",
    "",
    "<user_request>",
    userMessage,
    "</user_request>",
  ].join("\n");
}

export const GeminiAdapterLive = Layer.effect(GeminiAdapter, makeGeminiAdapter());

export function makeGeminiAdapterLive(options?: GeminiAdapterLiveOptions) {
  return Layer.effect(GeminiAdapter, makeGeminiAdapter(options));
}
