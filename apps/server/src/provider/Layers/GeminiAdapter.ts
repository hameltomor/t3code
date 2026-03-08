/**
 * GeminiAdapterLive - Scoped live implementation for the Gemini provider adapter.
 *
 * Wraps `@google/genai` SDK behind the generic provider adapter contract and
 * emits canonical runtime events. Implements a manual agent tool loop:
 *
 * 1. Send user message + tool declarations to Gemini
 * 2. Parse function call requests from the response
 * 3. Gate mutating tools behind approval flow
 * 4. Execute tools, emit canonical lifecycle events
 * 5. Send results back to Gemini, loop until final text answer
 *
 * @module GeminiAdapterLive
 */
import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@xbetools/contracts";
import { Cause, DateTime, Deferred, Effect, Layer, Queue, Random, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { GeminiAdapter, type GeminiAdapterShape } from "../Services/GeminiAdapter.ts";
import {
  materializeImageAttachments,
  type MaterializedImageAttachment,
} from "../attachmentMaterializer.ts";

import { GEMINI_FUNCTION_DECLARATIONS, toolRequiresApproval } from "../gemini/GeminiToolDefinitions.ts";
import {
  createEventEmitter,
  emitApprovalRequested,
  emitApprovalResolved,
  emitToolCompleted,
  emitToolStarted,
} from "../gemini/GeminiRuntimeEvents.ts";
import { executeGeminiTool, type ToolExecutionResult } from "../gemini/GeminiToolRuntime.ts";
import {
  deserializeTurn,
  parseFunctionCalls,
  serializeTurn,
  turnsToHistory,
  type TranscriptFunctionCall,
  type TranscriptFunctionResult,
  type TranscriptTurn,
} from "../gemini/GeminiTranscript.ts";

const PROVIDER = "gemini" as const;
const MAX_TOOL_LOOP_ITERATIONS = 25;

interface GeminiTurnState {
  readonly turnId: TurnId;
  readonly assistantItemId: string;
  readonly startedAt: string;
  emittedTextDelta: boolean;
  accumulatedText: string;
}

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

/** Pending approval state for a tool call awaiting user decision. */
interface PendingApproval {
  readonly requestId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly deferred: Deferred.Deferred<ProviderApprovalDecision>;
}

/** Pending user-input state for a tool call awaiting user answers. */
interface PendingUserInput {
  readonly requestId: string;
  readonly deferred: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface GeminiSessionContext {
  session: MutableSession;
  readonly ai: GoogleGenAI;
  readonly model: string;
  readonly config: GenerateContentConfig;
  readonly projectContext: string | undefined;
  readonly startedAt: string;
  readonly turns: TranscriptTurn[];
  readonly abortControllers: Set<AbortController>;
  turnState: GeminiTurnState | undefined;
  stopped: boolean;
  pendingApproval: PendingApproval | undefined;
  pendingUserInput: PendingUserInput | undefined;
}

export interface GeminiAdapterLiveOptions {
  readonly apiKey?: string;
  readonly stateDir?: string;
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
    turns: ctx.turns.map(serializeTurn),
  };
}

interface GeminiResumeState {
  threadId?: string;
  model?: string;
  turns: TranscriptTurn[];
}

function readResumeState(resumeCursor: unknown): GeminiResumeState | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") return undefined;
  const cursor = resumeCursor as Record<string, unknown>;
  const turns: TranscriptTurn[] = [];
  if (Array.isArray(cursor.turns)) {
    for (let i = 0; i < cursor.turns.length; i++) {
      const raw = cursor.turns[i] as Record<string, unknown>;
      if (!raw || typeof raw !== "object") continue;
      const turn = deserializeTurn(raw, TurnId.makeUnsafe(`restored-${i}`));
      if (turn) turns.push(turn);
    }
  }
  const result: GeminiResumeState = { turns };
  if (typeof cursor.threadId === "string") result.threadId = cursor.threadId;
  if (typeof cursor.model === "string") result.model = cursor.model;
  return result;
}

export function makeGeminiAdapter(options?: GeminiAdapterLiveOptions) {
  return Effect.gen(function* () {
    const sessions = new Map<ThreadId, GeminiSessionContext>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const emitter = createEventEmitter(runtimeEventQueue);

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

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
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
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
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
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
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
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

        // Reject pending approval/user-input
        if (ctx.pendingApproval) {
          yield* Deferred.succeed(ctx.pendingApproval.deferred, "cancel" as ProviderApprovalDecision);
          ctx.pendingApproval = undefined;
        }
        if (ctx.pendingUserInput) {
          yield* Deferred.succeed(ctx.pendingUserInput.deferred, {} as ProviderUserInputAnswers);
          ctx.pendingUserInput = undefined;
        }

        // Complete active turn if any
        if (ctx.turnState) {
          yield* completeTurn(ctx, "interrupted");
        }

        ctx.session.status = "closed";
        sessions.delete(ctx.session.threadId);

        if (opts.emitExitEvent) {
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
            type: "session.exited",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId: ctx.session.threadId,
            createdAt: stamp.createdAt,
            payload: { reason: "stopped", recoverable: false, exitKind: "graceful" },
          });
        }
      });

    /**
     * Call Gemini with the full transcript + tool declarations and return the response.
     * Uses non-streaming `generateContent` for the tool loop so we get complete
     * function call objects in a single response, and streaming for final text only.
     */
    const callGemini = (
      ctx: GeminiSessionContext,
      contents: Content[],
      abortSignal: AbortSignal,
    ): Effect.Effect<GenerateContentResponse, ProviderAdapterRequestError> =>
      Effect.tryPromise({
        try: () =>
          ctx.ai.models.generateContent({
            model: ctx.model,
            contents,
            config: {
              ...ctx.config,
              tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
              abortSignal,
            },
          }),
        catch: (cause) => {
          if (isAbortError(cause)) {
            return new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "generateContent",
              detail: "aborted",
            });
          }
          return new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "generateContent",
            detail: toMessage(cause, "Failed to call Gemini"),
          });
        },
      });

    /**
     * Execute one tool call: gate behind approval if needed, then run.
     */
    const executeToolCall = (
      ctx: GeminiSessionContext,
      call: TranscriptFunctionCall,
      turnId: TurnId,
    ): Effect.Effect<TranscriptFunctionResult, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        const threadId = ctx.session.threadId;
        const cwd = ctx.session.cwd ?? process.cwd();

        // Emit tool started
        yield* emitToolStarted(emitter, {
          threadId,
          turnId,
          toolCallId: call.id,
          toolName: call.name,
          args: call.args,
        });

        // Gate behind approval if the tool mutates state
        if (toolRequiresApproval(call.name)) {
          const requestId = yield* Random.nextUUIDv4;

          const deferred = yield* Deferred.make<ProviderApprovalDecision>();
          ctx.pendingApproval = {
            requestId,
            toolCallId: call.id,
            toolName: call.name,
            args: call.args,
            deferred,
          };

          // Emit approval request
          yield* emitApprovalRequested(emitter, {
            threadId,
            turnId,
            requestId,
            toolCallId: call.id,
            toolName: call.name,
            args: call.args,
          });

          // Change session state to waiting
          ctx.session.status = "running";
          {
            const stamp = yield* emitter.makeEventStamp();
            yield* emitter.emit({
              type: "session.state.changed",
              eventId: stamp.eventId,
              provider: PROVIDER,
              threadId,
              createdAt: stamp.createdAt,
              payload: { state: "waiting" },
            });
          }

          // Wait for user decision
          const decision = yield* Deferred.await(deferred);
          ctx.pendingApproval = undefined;

          const isApproved = decision === "accept" || decision === "acceptForSession";
          yield* emitApprovalResolved(emitter, {
            threadId,
            turnId,
            requestId,
            toolCallId: call.id,
            toolName: call.name,
            decision: isApproved ? "approved" : "denied",
          });

          if (!isApproved) {
            yield* emitToolCompleted(emitter, {
              threadId,
              turnId,
              toolCallId: call.id,
              toolName: call.name,
              args: call.args,
              result: { error: "Tool execution denied by user" },
              status: "declined",
            });
            return {
              id: call.id,
              name: call.name,
              response: { error: "Tool execution was denied by the user." },
            };
          }
        }

        // Execute the tool
        const result = yield* Effect.tryPromise({
          try: () => executeGeminiTool(call.name, call.args, cwd),
          catch: (err) => {
            const message = err instanceof Error ? err.message : "Tool execution failed";
            return new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: `tool/${call.name}`,
              detail: message,
            });
          },
        }).pipe(
          Effect.catchTag("ProviderAdapterRequestError", (err) =>
            Effect.gen(function* () {
              yield* emitToolCompleted(emitter, {
                threadId,
                turnId,
                toolCallId: call.id,
                toolName: call.name,
                args: call.args,
                result: { error: err.detail ?? "Tool execution failed" },
                status: "failed",
              });
              return {
                output: { error: err.detail ?? "Tool execution failed" },
                error: err.detail ?? "Tool execution failed",
              } as ToolExecutionResult;
            }),
          ),
        );

        yield* emitToolCompleted(emitter, {
          threadId,
          turnId,
          toolCallId: call.id,
          toolName: call.name,
          args: call.args,
          result: result.output,
          status: result.error ? "failed" : "completed",
        });

        return {
          id: call.id,
          name: call.name,
          response: result.output,
        };
      });

    /**
     * The main agent turn loop:
     * 1. Build contents from transcript + current user message
     * 2. Call Gemini with tool declarations
     * 3. If response has function calls, execute them with approval gating
     * 4. Send results back, loop
     * 5. When Gemini returns text without function calls, stream the final response
     */
    const runAgentLoop = (
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

        try {
          // Build initial contents from transcript history + new user message
          const historyContents = turnsToHistory(ctx.turns);
          const currentContents: Content[] = [
            ...historyContents,
            { role: "user", parts: [{ text: providerMessage }] },
          ];

          const toolInteractions: TranscriptTurn["toolInteractions"][number][] = [];
          let iterations = 0;

          while (iterations < MAX_TOOL_LOOP_ITERATIONS && !ctx.stopped && !abortController.signal.aborted) {
            iterations++;

            const response = yield* callGemini(ctx, currentContents, abortController.signal);

            // Check for function calls
            const functionCalls = response.functionCalls;
            if (!functionCalls || functionCalls.length === 0) {
              // No function calls - this is the final text response.
              // Extract text from the non-streaming response.
              const text = response.text ?? "";
              if (text.length > 0) {
                ts.accumulatedText += text;
                ts.emittedTextDelta = true;

                const stamp = yield* emitter.makeEventStamp();
                yield* emitter.emit({
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
              break;
            }

            // Parse and execute function calls
            const calls = parseFunctionCalls(functionCalls);

            // Add model's function call to the contents
            currentContents.push({
              role: "model",
              parts: calls.map((c) => ({
                functionCall: { id: c.id, name: c.name, args: c.args },
              })),
            });

            // Execute each call sequentially (respecting approval flow)
            const results: TranscriptFunctionResult[] = [];
            for (const call of calls) {
              if (ctx.stopped || abortController.signal.aborted) break;
              const result = yield* executeToolCall(ctx, call, ts.turnId);
              results.push(result);
              toolInteractions.push({ call, result });
            }

            if (ctx.stopped || abortController.signal.aborted) break;

            // Add function results to contents
            currentContents.push({
              role: "user",
              parts: results.map((r) => ({
                functionResponse: {
                  id: r.id,
                  name: r.name,
                  response: r.response,
                },
              })),
            });

            // Also extract any text from the model response (thinking/reasoning)
            const intermediateText = response.text ?? "";
            if (intermediateText.length > 0) {
              // Append model text part too so transcript is correct
              // But don't emit as assistant text yet - it's intermediate
            }
          }

          if (ctx.stopped || abortController.signal.aborted) {
            // Turn was interrupted — mark it as such, don't persist to transcript
            yield* completeTurn(ctx, "interrupted");
          } else if (iterations >= MAX_TOOL_LOOP_ITERATIONS) {
            // Safety cap reached without a final answer
            ctx.turns.push({
              id: ts.turnId,
              userMessage,
              providerMessage,
              assistantText: ts.accumulatedText || "(Agent reached maximum tool iterations without a final answer)",
              toolInteractions,
            });
            yield* completeTurn(ctx, "failed", "Agent reached maximum tool loop iterations");
          } else {
            // Normal completion
            ctx.turns.push({
              id: ts.turnId,
              userMessage,
              providerMessage,
              assistantText: ts.accumulatedText,
              toolInteractions,
            });
            yield* completeTurn(ctx, "completed");
          }
        } finally {
          cleanup();
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

        const resumeState = readResumeState(input.resumeCursor);
        const model =
          input.model ?? resumeState?.model ?? DEFAULT_MODEL_BY_PROVIDER.gemini;

        const projectContext = input.cwd ? gatherProjectContext(input.cwd) : undefined;
        const systemInstruction = buildSystemInstruction(input.cwd, projectContext);
        const config: GenerateContentConfig = systemInstruction
          ? { systemInstruction }
          : {};

        const ai = new GoogleGenAI({ apiKey });

        const restoredTurns = resumeState?.turns ?? [];
        const now = yield* nowIso;

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
            turns: restoredTurns.map(serializeTurn),
          },
          activeTurnId: undefined,
          createdAt: now,
          updatedAt: now,
        };

        const ctx: GeminiSessionContext = {
          session,
          ai,
          model,
          config,
          projectContext,
          startedAt: now,
          turns: [...restoredTurns],
          abortControllers: new Set(),
          turnState: undefined,
          stopped: false,
          pendingApproval: undefined,
          pendingUserInput: undefined,
        };
        sessions.set(threadId, ctx);

        {
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
            type: "session.started",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            payload: {},
          });
        }
        {
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
            type: "session.configured",
            eventId: stamp.eventId,
            provider: PROVIDER,
            threadId,
            createdAt: stamp.createdAt,
            payload: { config: { model } },
          });
        }
        {
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
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
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
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
          const stamp = yield* emitter.makeEventStamp();
          yield* emitter.emit({
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

        // Materialize image attachments when stateDir is available
        const materializedImages =
          options?.stateDir && input.attachments && input.attachments.length > 0
            ? materializeImageAttachments({
                stateDir: options.stateDir,
                attachments: input.attachments,
              })
            : undefined;

        const userMessage = buildUserMessage(input, materializedImages);
        const providerMessage = buildProviderMessage(userMessage, {
          cwd: ctx.session.cwd,
          projectContext: ctx.projectContext,
          ...(materializedImages ? { materializedImages } : {}),
        });
        const threadId = input.threadId;

        // Run agent loop in background (non-blocking)
        Effect.runFork(
          runAgentLoop(ctx, userMessage, providerMessage).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                if (Cause.hasInterruptsOnly(cause) || ctx.stopped) return;

                const squashed = Cause.squash(cause);

                if (isAbortError(squashed)) {
                  yield* completeTurn(ctx, "interrupted");
                  return;
                }

                const msg = toMessage(squashed, "Gemini agent loop failed");

                if (
                  squashed &&
                  typeof squashed === "object" &&
                  "detail" in squashed &&
                  (squashed as { detail: string }).detail === "aborted"
                ) {
                  yield* completeTurn(ctx, "interrupted");
                  return;
                }

                const stamp = yield* emitter.makeEventStamp();
                yield* emitter.emit({
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
        // Abort all in-flight API calls — the tool loop checks abortController.signal.aborted
        for (const controller of ctx.abortControllers) {
          controller.abort();
        }
        // Don't clear controllers here; the loop cleanup will handle that

        // Resolve any pending approval/user-input as cancel so the loop unblocks and exits
        if (ctx.pendingApproval) {
          yield* Deferred.succeed(ctx.pendingApproval.deferred, "cancel" as ProviderApprovalDecision);
          ctx.pendingApproval = undefined;
        }
        if (ctx.pendingUserInput) {
          yield* Deferred.succeed(ctx.pendingUserInput.deferred, {} as ProviderUserInputAnswers);
          ctx.pendingUserInput = undefined;
        }
      });

    const readThread: GeminiAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return {
          threadId,
          turns: ctx.turns.map((turn) => ({
            id: turn.id,
            items: [
              { type: "assistant_message" as const, text: turn.assistantText },
              ...turn.toolInteractions.map((ti) => ({
                type: "tool_call" as const,
                name: ti.call.name,
                args: ti.call.args,
                result: ti.result.response,
              })),
            ],
          })),
        };
      });

    const rollbackThread: GeminiAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const removeCount = Math.min(numTurns, ctx.turns.length);
        ctx.turns.splice(ctx.turns.length - removeCount, removeCount);
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
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (!ctx.pendingApproval) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `No pending approval request for thread '${threadId}'.`,
          });
        }
        if (ctx.pendingApproval.requestId !== requestId) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `Request ID mismatch: expected '${ctx.pendingApproval.requestId}', got '${requestId}'.`,
          });
        }
        yield* Deferred.succeed(ctx.pendingApproval.deferred, decision);
      });

    const respondToUserInput: GeminiAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (!ctx.pendingUserInput) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: `No pending user-input request for thread '${threadId}'.`,
          });
        }
        if (ctx.pendingUserInput.requestId !== requestId) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: `Request ID mismatch: expected '${ctx.pendingUserInput.requestId}', got '${requestId}'.`,
          });
        }
        yield* Deferred.succeed(ctx.pendingUserInput.deferred, answers);
      });

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
    "You are an expert coding agent for the user's current repository.",
    "You have access to tools that let you read files, search code, list directories, run commands, and apply patches.",
    "Use these tools to investigate the codebase and make changes when asked.",
    "The project context below was loaded from disk on the server for initial orientation.",
    `The user's project is located at: ${cwd}`,
    "Use tools to get fresh, detailed information rather than relying solely on the initial context.",
    "",
    "## Initial Project Context",
    projectContext,
  ].join("\n");
}

function buildUserMessage(
  input: ProviderSendTurnInput,
  materializedImages?: MaterializedImageAttachment[],
): string {
  const parts: string[] = [];
  if (input.input) {
    parts.push(input.input);
  }
  const materializedIds = new Set(materializedImages?.map((img) => img.id) ?? []);
  if (input.attachments && input.attachments.length > 0) {
    for (const attachment of input.attachments) {
      if (materializedIds.has(attachment.id)) continue;
      if (attachment.name) {
        parts.push(`[Attachment: ${attachment.name} (${attachment.mimeType})]`);
      }
    }
  }
  return parts.join("\n\n") || "Continue.";
}

function buildProviderMessage(
  userMessage: string,
  _opts: {
    cwd: string | undefined;
    projectContext: string | undefined;
    materializedImages?: MaterializedImageAttachment[];
  },
): string {
  // For the agent loop, project context is in systemInstruction.
  // Images are deferred to the attachment parity phase.
  return userMessage;
}

export const GeminiAdapterLive = Layer.effect(GeminiAdapter, makeGeminiAdapter());

export function makeGeminiAdapterLive(options?: GeminiAdapterLiveOptions) {
  return Layer.effect(GeminiAdapter, makeGeminiAdapter(options));
}
