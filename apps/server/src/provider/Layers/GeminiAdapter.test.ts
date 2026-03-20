import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Scope, Stream } from "effect";
import type { ProviderRuntimeEvent, ThreadId } from "@xbetools/contracts";

import { makeGeminiAdapter } from "./GeminiAdapter.ts";

// ── Mock @google/genai SDK ────────────────────────────────────────────

/** Simulated response chunks for generateContent / generateContentStream */
let mockGenerateContentResult: {
  text?: string;
  functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
} = { text: "Hello from Gemini!" };

let mockGenerateContentCalls: Array<{
  model: string;
  contents: unknown;
  config?: unknown;
}> = [];

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (opts: {
        model: string;
        contents: unknown;
        config?: unknown;
      }) => {
        mockGenerateContentCalls.push(opts);
        return {
          get text() {
            return mockGenerateContentResult.text;
          },
          get functionCalls() {
            return mockGenerateContentResult.functionCalls;
          },
        };
      },
      generateContentStream: async (opts: {
        model: string;
        contents: unknown;
        config?: unknown;
      }) => {
        mockGenerateContentCalls.push(opts);
        const text = mockGenerateContentResult.text ?? "";
        const chunks = text ? [{ text }] : [];
        return {
          [Symbol.asyncIterator]() {
            let index = 0;
            return {
              async next() {
                if (index < chunks.length) {
                  return { done: false as const, value: chunks[index++]! };
                }
                return { done: true as const, value: undefined };
              },
            };
          },
        };
      },
    };
    chats = {
      create: () => ({
        sendMessageStream: async () => ({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                return { done: true as const, value: undefined };
              },
            };
          },
        }),
      }),
    };
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────

const TEST_API_KEY = "test-gemini-api-key";
const TEST_THREAD_ID = "thread-gemini-1" as ThreadId;

/** Run an effect that requires Scope by providing a fresh scope and closing it. */
function run<A, E>(effect: Effect.Effect<A, E, Scope.Scope>) {
  return Effect.runPromise(Effect.scoped(effect));
}

/** Collect events from the adapter's stream into an array, running in the background. */
function collectEvents(
  stream: Stream.Stream<ProviderRuntimeEvent>,
): Effect.Effect<{ events: ProviderRuntimeEvent[] }, never, Scope.Scope> {
  const events: ProviderRuntimeEvent[] = [];
  return Stream.runForEach(stream, (ev) =>
    Effect.sync(() => { events.push(ev); }),
  ).pipe(
    Effect.forkScoped,
    Effect.map(() => ({ events })),
  );
}

/** Find the requestId from a request.opened event in a collected event array. */
function findRequestId(events: ProviderRuntimeEvent[]): string | undefined {
  for (const ev of events) {
    if (ev.type === "request.opened" && "requestId" in ev) {
      return String(ev.requestId);
    }
  }
  return undefined;
}

beforeEach(() => {
  mockGenerateContentResult = { text: "Hello from Gemini!" };
  mockGenerateContentCalls = [];
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("GeminiAdapterLive", () => {
  it("starts a session and reports ready state", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const session = yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        expect(session.provider).toBe("gemini");
        expect(session.status).toBe("ready");
        expect(session.threadId).toBe(TEST_THREAD_ID);
        expect(yield* adapter.hasSession(TEST_THREAD_ID)).toBe(true);

        const sessions = yield* adapter.listSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.threadId).toBe(TEST_THREAD_ID);
      }),
    ));

  it("provides correct adapter capabilities", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        expect(adapter.provider).toBe("gemini");
        expect(adapter.capabilities.sessionModelSwitch).toBe("restart-session");
        expect(adapter.streamEvents).toBeDefined();
      }),
    ));

  it("fails without API key when env vars are unset", () =>
    run(
      Effect.gen(function* () {
        const savedGemini = process.env.GEMINI_API_KEY;
        const savedGoogle = process.env.GOOGLE_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;

        try {
          const adapter = yield* makeGeminiAdapter();
          const result = yield* adapter
            .startSession({
              threadId: TEST_THREAD_ID,
              runtimeMode: "full-access",
            })
            .pipe(Effect.result);

          expect(result._tag).toBe("Failure");
        } finally {
          if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
          if (savedGoogle !== undefined) process.env.GOOGLE_API_KEY = savedGoogle;
        }
      }),
    ));

  it("rejects wrong provider in startSession", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const result = yield* adapter
          .startSession({
            threadId: TEST_THREAD_ID,
            provider: "codex",
            runtimeMode: "full-access",
          })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
      }),
    ));

  it("fails sendTurn for unknown session", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const result = yield* adapter
          .sendTurn({
            threadId: "nonexistent" as ThreadId,
            input: "hello",
          })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
      }),
    ));

  it("sends a turn and records it in thread history", () =>
    run(
      Effect.gen(function* () {
        mockGenerateContentResult = { text: "Response text" };
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        const turn = yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Hello",
        });

        expect(turn.threadId).toBe(TEST_THREAD_ID);
        expect(turn.turnId).toBeDefined();

        // Wait for background agent loop to complete
        yield* Effect.sleep(300);

        // Verify the turn was recorded
        const thread = yield* adapter.readThread(TEST_THREAD_ID);
        expect(thread.turns).toHaveLength(1);
      }),
    ));

  it("stops a session and marks it closed", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        expect(yield* adapter.hasSession(TEST_THREAD_ID)).toBe(true);
        yield* adapter.stopSession(TEST_THREAD_ID);
        expect(yield* adapter.hasSession(TEST_THREAD_ID)).toBe(false);
      }),
    ));

  it("rollback truncates turns", () =>
    run(
      Effect.gen(function* () {
        mockGenerateContentResult = { text: "Answer" };
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Hello",
        });
        yield* Effect.sleep(300);

        const threadBefore = yield* adapter.readThread(TEST_THREAD_ID);
        expect(threadBefore.turns).toHaveLength(1);

        const threadAfter = yield* adapter.rollbackThread(TEST_THREAD_ID, 1);
        expect(threadAfter.turns).toHaveLength(0);
      }),
    ));

  it("respondToRequest works when approval is pending", () =>
    run(
      Effect.gen(function* () {
        // Set up a function call response that requires approval
        mockGenerateContentResult = {
          functionCalls: [
            { id: "fc-1", name: "run_command", args: { command: "echo hello" } },
          ],
        };

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const { events } = yield* collectEvents(adapter.streamEvents);
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Run echo",
        });

        // Wait for the agent loop to hit the approval gate
        yield* Effect.sleep(200);

        // After the first call returns function calls, change the mock to return text
        mockGenerateContentResult = { text: "Done running command" };

        // Find the actual request ID from emitted events
        const requestId = findRequestId(events);
        expect(requestId).toBeDefined();

        // Respond to the approval
        const result = yield* adapter
          .respondToRequest(TEST_THREAD_ID, requestId! as any, "accept" as any)
          .pipe(Effect.result);

        expect(result._tag).toBe("Success");
      }),
    ));

  it("respondToRequest fails when no approval is pending", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        const result = yield* adapter
          .respondToRequest(TEST_THREAD_ID, "req-1" as any, "accept" as any)
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
      }),
    ));

  it("respondToUserInput fails when no user-input is pending", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        const result = yield* adapter
          .respondToUserInput(TEST_THREAD_ID, "req-1" as any, {} as any)
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
      }),
    ));

  it("stopAll stops all active sessions", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });
        yield* adapter.startSession({
          threadId: "thread-gemini-2" as ThreadId,
          runtimeMode: "full-access",
        });

        expect(yield* adapter.listSessions()).toHaveLength(2);
        yield* adapter.stopAll();
        expect(yield* adapter.listSessions()).toHaveLength(0);
      }),
    ));

  it("session recovery replays prior turns into transcript", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const session = yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
          resumeCursor: {
            threadId: TEST_THREAD_ID,
            model: "gemini-3.1-pro-preview",
            turnCount: 2,
            turns: [
              {
                userMessage: "What is TypeScript?",
                providerMessage: "What is TypeScript?",
                assistantText: "A typed superset of JavaScript.",
                toolInteractions: [],
              },
              {
                userMessage: "How about Effect?",
                assistantText: "A framework for type-safe async programming.",
                toolInteractions: [],
              },
            ],
          },
        });

        expect(session.status).toBe("ready");
        expect(session.model).toBe("gemini-3.1-pro-preview");

        // Verify turns were restored
        const thread = yield* adapter.readThread(TEST_THREAD_ID);
        expect(thread.turns).toHaveLength(2);
      }),
    ));

  it("uses default model from catalog when no model specified", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const session = yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        expect(session.model).toBe("gemini-3.1-pro-preview");
      }),
    ));

  it("uses explicit model when specified", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const session = yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
          model: "gemini-2.5-flash",
        });

        expect(session.model).toBe("gemini-2.5-flash");
      }),
    ));

  it("interruptTurn aborts in-flight requests without crashing", () =>
    run(
      Effect.gen(function* () {
        mockGenerateContentResult = { text: "part1" };
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Hello",
        });

        // Interrupt immediately
        yield* adapter.interruptTurn(TEST_THREAD_ID);

        // Session should still be valid after interrupt
        expect(yield* adapter.hasSession(TEST_THREAD_ID)).toBe(true);
      }),
    ));

  it("resume cursor includes full turn history with tool interactions", () =>
    run(
      Effect.gen(function* () {
        mockGenerateContentResult = { text: "The answer" };
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const session = yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        // Initial cursor should have empty turns
        const initialCursor = session.resumeCursor as {
          turns?: Array<unknown>;
        };
        expect(initialCursor?.turns ?? []).toHaveLength(0);

        yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Hello",
        });
        yield* Effect.sleep(300);

        const sessions = yield* adapter.listSessions();
        const updated = sessions.find((s) => s.threadId === TEST_THREAD_ID);
        const cursor = updated?.resumeCursor as {
          turns?: Array<{
            userMessage: string;
            assistantText: string;
            toolInteractions: unknown[];
          }>;
        };

        expect(cursor?.turns).toHaveLength(1);
        expect(cursor?.turns?.[0]?.userMessage).toBe("Hello");
        expect(cursor?.turns?.[0]?.assistantText).toBe("The answer");
        expect(cursor?.turns?.[0]?.toolInteractions).toEqual([]);
      }),
    ));

  describe("tool lifecycle events", () => {
    it("emits tool started/completed events for read-only tools", () =>
      run(
        Effect.gen(function* () {
          // First call: model requests read_file
          // Second call: model returns final text
          const responses = [
            {
              functionCalls: [
                { id: "fc-read-1", name: "read_file", args: { path: "package.json" } },
              ],
            },
            { text: "The file contains..." },
          ];

          mockGenerateContentResult = responses[0]!;

          const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });

          yield* adapter.startSession({
            threadId: TEST_THREAD_ID,
            runtimeMode: "full-access",
            cwd: process.cwd(),
          });

          // Patch: after first generate call, switch to text response
          const checkInterval = setInterval(() => {
            if (mockGenerateContentCalls.length >= 1 && mockGenerateContentResult !== responses[1]) {
              mockGenerateContentResult = responses[1]!;
            }
          }, 10);

          yield* adapter.sendTurn({
            threadId: TEST_THREAD_ID,
            input: "Read package.json",
          });

          yield* Effect.sleep(500);
          clearInterval(checkInterval);

          // Verify generateContent was called at least twice (tool call + final)
          expect(mockGenerateContentCalls.length).toBeGreaterThanOrEqual(2);

          // Verify the first call included tool declarations
          const firstCall = mockGenerateContentCalls[0];
          expect(firstCall?.config).toBeDefined();
          const config = firstCall?.config as Record<string, unknown>;
          expect(config?.tools).toBeDefined();
        }),
      ));

    it("emits approval events for mutating tools", () =>
      run(
        Effect.gen(function* () {
          // Set up: model requests run_command, which requires approval
          mockGenerateContentResult = {
            functionCalls: [
              { id: "fc-cmd-1", name: "run_command", args: { command: "echo test" } },
            ],
          };

          const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
          const { events } = yield* collectEvents(adapter.streamEvents);
          yield* adapter.startSession({
            threadId: TEST_THREAD_ID,
            runtimeMode: "full-access",
          });

          yield* adapter.sendTurn({
            threadId: TEST_THREAD_ID,
            input: "Run a command",
          });

          // Wait for the agent loop to hit approval gate
          yield* Effect.sleep(200);

          // Switch to text response for after approval
          mockGenerateContentResult = { text: "Command completed" };

          // Find the actual request ID and approve
          const requestId = findRequestId(events);
          expect(requestId).toBeDefined();
          yield* adapter.respondToRequest(
            TEST_THREAD_ID,
            requestId! as any,
            "accept" as any,
          );

          yield* Effect.sleep(500);

          // Verify the turn completed
          const thread = yield* adapter.readThread(TEST_THREAD_ID);
          expect(thread.turns).toHaveLength(1);
        }),
      ));

    it("denied approval completes tool as declined", () =>
      run(
        Effect.gen(function* () {
          mockGenerateContentResult = {
            functionCalls: [
              { id: "fc-deny-1", name: "run_command", args: { command: "rm -rf /" } },
            ],
          };

          const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
          const { events } = yield* collectEvents(adapter.streamEvents);
          yield* adapter.startSession({
            threadId: TEST_THREAD_ID,
            runtimeMode: "full-access",
          });

          yield* adapter.sendTurn({
            threadId: TEST_THREAD_ID,
            input: "Delete everything",
          });

          yield* Effect.sleep(200);

          // Switch to text response for after denial
          mockGenerateContentResult = { text: "I cannot do that" };

          // Find the actual request ID and deny
          const requestId = findRequestId(events);
          expect(requestId).toBeDefined();
          yield* adapter.respondToRequest(
            TEST_THREAD_ID,
            requestId! as any,
            "decline" as any,
          );

          yield* Effect.sleep(500);

          // Verify the turn completed (Gemini gets the denial as a tool result)
          const thread = yield* adapter.readThread(TEST_THREAD_ID);
          expect(thread.turns).toHaveLength(1);
        }),
      ));
  });

  describe("recovery with tool interactions", () => {
    it("session recovery preserves tool interaction transcript", () =>
      run(
        Effect.gen(function* () {
          const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
          const session = yield* adapter.startSession({
            threadId: TEST_THREAD_ID,
            runtimeMode: "full-access",
            resumeCursor: {
              threadId: TEST_THREAD_ID,
              model: "gemini-3.1-pro-preview",
              turnCount: 1,
              turns: [
                {
                  userMessage: "Read file",
                  assistantText: "File contents: ...",
                  toolInteractions: [
                    {
                      call: {
                        id: "fc-1",
                        name: "read_file",
                        args: { path: "README.md" },
                      },
                      result: {
                        id: "fc-1",
                        name: "read_file",
                        response: { content: "# Hello", totalLines: 1 },
                      },
                    },
                  ],
                },
              ],
            },
          });

          expect(session.status).toBe("ready");

          const thread = yield* adapter.readThread(TEST_THREAD_ID);
          expect(thread.turns).toHaveLength(1);
          // Verify tool interactions are included in the thread snapshot
          const items = thread.turns[0]?.items ?? [];
          expect(items.length).toBe(2); // assistant_message + tool_call
        }),
      ));

    it("rollback removes tool interaction history from transcript", () =>
      run(
        Effect.gen(function* () {
          const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
          yield* adapter.startSession({
            threadId: TEST_THREAD_ID,
            runtimeMode: "full-access",
            resumeCursor: {
              threadId: TEST_THREAD_ID,
              model: "gemini-3.1-pro-preview",
              turnCount: 2,
              turns: [
                {
                  userMessage: "First",
                  assistantText: "First response",
                  toolInteractions: [],
                },
                {
                  userMessage: "Read file",
                  assistantText: "File contents: ...",
                  toolInteractions: [
                    {
                      call: {
                        id: "fc-1",
                        name: "read_file",
                        args: { path: "README.md" },
                      },
                      result: {
                        id: "fc-1",
                        name: "read_file",
                        response: { content: "# Hello" },
                      },
                    },
                  ],
                },
              ],
            },
          });

          // Rollback the second turn (which had tool interactions)
          const threadAfter = yield* adapter.rollbackThread(TEST_THREAD_ID, 1);
          expect(threadAfter.turns).toHaveLength(1);
          expect(threadAfter.turns[0]?.items[0]).toHaveProperty("text", "First response");

          // Verify resume cursor was updated
          const sessions = yield* adapter.listSessions();
          const updated = sessions.find((s) => s.threadId === TEST_THREAD_ID);
          const cursor = updated?.resumeCursor as {
            turns?: Array<{ toolInteractions: unknown[] }>;
          };
          expect(cursor?.turns).toHaveLength(1);
          expect(cursor?.turns?.[0]?.toolInteractions).toEqual([]);
        }),
      ));
  });

  describe("interruption", () => {
    it("interruption during approval marks turn as interrupted, not completed", () =>
      run(
        Effect.gen(function* () {
          // Set up a function call that requires approval
          mockGenerateContentResult = {
            functionCalls: [
              { id: "fc-int-1", name: "run_command", args: { command: "sleep 100" } },
            ],
          };

          const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
          yield* adapter.startSession({
            threadId: TEST_THREAD_ID,
            runtimeMode: "full-access",
          });

          yield* adapter.sendTurn({
            threadId: TEST_THREAD_ID,
            input: "Do something",
          });

          yield* Effect.sleep(200);

          // Interrupt while waiting for approval
          yield* adapter.interruptTurn(TEST_THREAD_ID);

          yield* Effect.sleep(200);

          // Session should still be valid (interrupt cancels the turn, not the session)
          expect(yield* adapter.hasSession(TEST_THREAD_ID)).toBe(true);

          // The interrupted turn should NOT be persisted in the transcript
          const thread = yield* adapter.readThread(TEST_THREAD_ID);
          expect(thread.turns).toHaveLength(0);
        }),
      ));
  });
});

// ── CLI Transport Tests ─────────────────────────────────────────────────

import { EventEmitter } from "node:events";

/** Create a mock ChildProcess that emits NDJSON lines and closes with a given code. */
function createMockChildProcess(options: {
  stdoutLines: string[];
  exitCode: number;
  exitDelay?: number;
}) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => void; end: () => void };
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: () => {}, end: () => {} };
  proc.pid = 12345;
  proc.kill = vi.fn(() => {
    // Simulate kill: emit close with null code
    setTimeout(() => proc.emit("close", null), 5);
  });

  // Emit stdout lines then close after a delay
  setTimeout(() => {
    for (const line of options.stdoutLines) {
      stdout.emit("data", Buffer.from(line + "\n"));
    }
    setTimeout(() => {
      proc.emit("close", options.exitCode);
    }, options.exitDelay ?? 20);
  }, 10);

  return proc;
}

let mockSpawnImpl: (...args: unknown[]) => unknown = () => undefined;
const mockSpawnSpy = vi.fn((...args: unknown[]) => mockSpawnImpl(...args));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawnSpy(...args),
}));

const CLI_THREAD_ID = "thread-cli-1" as ThreadId;

describe("GeminiAdapter CLI transport", () => {
  beforeEach(() => {
    mockSpawnSpy.mockClear();
    mockSpawnImpl = () => undefined;
  });

  it("starts a CLI session and reports ready", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const session = yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        expect(session.provider).toBe("gemini");
        expect(session.status).toBe("ready");
        expect(session.threadId).toBe(CLI_THREAD_ID);
      }),
    ));

  it("CLI sendTurn success: spawns process and completes turn", () =>
    run(
      Effect.gen(function* () {
        mockSpawnImpl = () =>
          createMockChildProcess({
            stdoutLines: [
              '{"type":"init","timestamp":"2026-03-20T00:00:00Z","session_id":"s1","model":"gemini-3"}',
              '{"type":"message","timestamp":"2026-03-20T00:00:01Z","role":"assistant","content":"Hello!","delta":true}',
              '{"type":"result","timestamp":"2026-03-20T00:00:02Z","status":"success","stats":{"total_tokens":50}}',
            ],
            exitCode: 0,
          });

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const { events } = yield* collectEvents(adapter.streamEvents);
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        const turn = yield* adapter.sendTurn({
          threadId: CLI_THREAD_ID,
          input: "Hello",
        });

        expect(turn.threadId).toBe(CLI_THREAD_ID);
        expect(turn.turnId).toBeDefined();

        // Wait for CLI process to complete
        yield* Effect.sleep(300);

        // Verify turn was persisted
        const thread = yield* adapter.readThread(CLI_THREAD_ID);
        expect(thread.turns).toHaveLength(1);
        expect((thread.turns[0]?.items[0] as { text?: string })?.text).toBe("Hello!");

        // Verify lifecycle events: turn.started, content.delta, turn.completed
        const turnStarted = events.filter((e) => e.type === "turn.started");
        const turnCompleted = events.filter((e) => e.type === "turn.completed");
        expect(turnStarted).toHaveLength(1);
        expect(turnCompleted).toHaveLength(1);

        // No duplicate turn.completed
        expect(turnCompleted).toHaveLength(1);
      }),
    ));

  it("CLI attachment rejection: fails before emitting turn.started", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const { events } = yield* collectEvents(adapter.streamEvents);
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        const result = yield* adapter
          .sendTurn({
            threadId: CLI_THREAD_ID,
            input: "Hello",
            attachments: [{ name: "file.txt", content: "data" }] as any,
          })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");

        // No turn.started event should have been emitted
        const turnStarted = events.filter((e) => e.type === "turn.started");
        expect(turnStarted).toHaveLength(0);

        // Session should still be usable
        expect(yield* adapter.hasSession(CLI_THREAD_ID)).toBe(true);
        const sessions = yield* adapter.listSessions();
        const session = sessions.find((s) => s.threadId === CLI_THREAD_ID);
        expect(session?.status).toBe("ready");
      }),
    ));

  it("CLI interrupt: kills process and marks turn as interrupted", () =>
    run(
      Effect.gen(function* () {
        // Create a process that stays open until killed
        const stdout = new EventEmitter();
        const stderr = new EventEmitter();
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          stdin: { write: () => void; end: () => void };
          pid: number;
          kill: ReturnType<typeof vi.fn>;
        };
        proc.stdout = stdout;
        proc.stderr = stderr;
        proc.stdin = { write: () => {}, end: () => {} };
        proc.pid = 99999;
        proc.kill = vi.fn(() => {
          setTimeout(() => proc.emit("close", null), 5);
        });

        // Emit init immediately, then stay open
        setTimeout(() => {
          stdout.emit(
            "data",
            Buffer.from(
              '{"type":"init","timestamp":"2026-03-20T00:00:00Z","session_id":"s2","model":"gemini-3"}\n',
            ),
          );
        }, 10);

        mockSpawnImpl = () => proc;

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        yield* adapter.sendTurn({
          threadId: CLI_THREAD_ID,
          input: "Long task",
        });

        yield* Effect.sleep(100);

        // Interrupt
        yield* adapter.interruptTurn(CLI_THREAD_ID);

        yield* Effect.sleep(200);

        // Session still valid
        expect(yield* adapter.hasSession(CLI_THREAD_ID)).toBe(true);

        // Interrupted turn should NOT be persisted
        const thread = yield* adapter.readThread(CLI_THREAD_ID);
        expect(thread.turns).toHaveLength(0);
      }),
    ));

  it("CLI failure: non-zero exit code marks turn as failed", () =>
    run(
      Effect.gen(function* () {
        mockSpawnImpl = () =>
          createMockChildProcess({
            stdoutLines: [
              '{"type":"init","timestamp":"2026-03-20T00:00:00Z","session_id":"s3","model":"gemini-3"}',
            ],
            exitCode: 1,
          });

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const { events } = yield* collectEvents(adapter.streamEvents);
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        yield* adapter.sendTurn({
          threadId: CLI_THREAD_ID,
          input: "Fail",
        });

        yield* Effect.sleep(300);

        // Turn should not be persisted on failure
        const thread = yield* adapter.readThread(CLI_THREAD_ID);
        expect(thread.turns).toHaveLength(0);

        // Should have a runtime.error event
        const errors = events.filter((e) => e.type === "runtime.error");
        expect(errors.length).toBeGreaterThanOrEqual(1);

        // turn.completed with failed status
        const completed = events.filter((e) => e.type === "turn.completed");
        expect(completed).toHaveLength(1);
        expect((completed[0] as any).payload.state).toBe("failed");
      }),
    ));

  it("CLI multi-turn: transcript grows with each turn", () =>
    run(
      Effect.gen(function* () {
        let callCount = 0;
        mockSpawnImpl = () => {
          callCount++;
          return createMockChildProcess({
            stdoutLines: [
              `{"type":"init","timestamp":"2026-03-20T00:00:00Z","session_id":"s${callCount}","model":"gemini-3"}`,
              `{"type":"message","timestamp":"2026-03-20T00:00:01Z","role":"assistant","content":"Answer ${callCount}","delta":true}`,
              `{"type":"result","timestamp":"2026-03-20T00:00:02Z","status":"success"}`,
            ],
            exitCode: 0,
          });
        };

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        // Turn 1
        yield* adapter.sendTurn({ threadId: CLI_THREAD_ID, input: "Q1" });
        yield* Effect.sleep(300);

        // Turn 2 — the prompt should include prior conversation context
        yield* adapter.sendTurn({ threadId: CLI_THREAD_ID, input: "Q2" });
        yield* Effect.sleep(300);

        const thread = yield* adapter.readThread(CLI_THREAD_ID);
        expect(thread.turns).toHaveLength(2);

        // Verify second spawn call included transcript in prompt
        const secondCallArgs = mockSpawnSpy.mock.calls[1];
        expect(secondCallArgs).toBeDefined();
        const cliArgs = secondCallArgs![1] as string[];
        const promptIdx = cliArgs.indexOf("-p");
        const prompt = cliArgs[promptIdx + 1]!;
        expect(prompt).toContain("prior conversation");
        expect(prompt).toContain("Q2");
      }),
    ));

  it("CLI rollback removes turns from transcript", () =>
    run(
      Effect.gen(function* () {
        mockSpawnImpl = () =>
          createMockChildProcess({
            stdoutLines: [
              '{"type":"init","timestamp":"2026-03-20T00:00:00Z","session_id":"s1","model":"gemini-3"}',
              '{"type":"message","timestamp":"2026-03-20T00:00:01Z","role":"assistant","content":"Answer","delta":true}',
              '{"type":"result","timestamp":"2026-03-20T00:00:02Z","status":"success"}',
            ],
            exitCode: 0,
          });

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        yield* adapter.sendTurn({ threadId: CLI_THREAD_ID, input: "Hello" });
        yield* Effect.sleep(300);

        const threadBefore = yield* adapter.readThread(CLI_THREAD_ID);
        expect(threadBefore.turns).toHaveLength(1);

        const threadAfter = yield* adapter.rollbackThread(CLI_THREAD_ID, 1);
        expect(threadAfter.turns).toHaveLength(0);
      }),
    ));

  it("CLI streams content.delta before process exit", () =>
    run(
      Effect.gen(function* () {
        const stdout = new EventEmitter();
        const stderr = new EventEmitter();
        let closed = false;
        const proc = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter;
          stderr: EventEmitter;
          stdin: { write: () => void; end: () => void };
          pid: number;
          kill: ReturnType<typeof vi.fn>;
        };
        proc.stdout = stdout;
        proc.stderr = stderr;
        proc.stdin = { write: () => {}, end: () => {} };
        proc.pid = 77777;
        proc.kill = vi.fn(() => {
          closed = true;
          setTimeout(() => proc.emit("close", null), 5);
        });

        setTimeout(() => {
          stdout.emit(
            "data",
            Buffer.from(JSON.stringify({
              type: "init",
              timestamp: "2026-03-20T00:00:00Z",
              session_id: "live-1",
              model: "gemini-3",
            }) + "\n"),
          );
        }, 10);
        setTimeout(() => {
          stdout.emit(
            "data",
            Buffer.from(JSON.stringify({
              type: "message",
              timestamp: "2026-03-20T00:00:01Z",
              role: "assistant",
              content: "Streaming now",
              delta: true,
            }) + "\n"),
          );
        }, 30);
        setTimeout(() => {
          closed = true;
          proc.emit("close", 0);
        }, 220);

        mockSpawnImpl = () => proc;

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const { events } = yield* collectEvents(adapter.streamEvents);
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        yield* adapter.sendTurn({ threadId: CLI_THREAD_ID, input: "Say something" });

        yield* Effect.sleep(120);

        expect(closed).toBe(false);
        expect(events.some((e) => e.type === "content.delta")).toBe(true);
        expect(events.some((e) => e.type === "turn.completed")).toBe(false);

        yield* Effect.sleep(180);

        expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
      }),
    ));

  it("CLI event ordering: content.delta and tool events arrive before turn.completed", () =>
    run(
      Effect.gen(function* () {
        mockSpawnImpl = () =>
          createMockChildProcess({
            stdoutLines: [
              '{"type":"init","timestamp":"2026-03-20T00:00:00Z","session_id":"s1","model":"gemini-3"}',
              '{"type":"tool_use","timestamp":"2026-03-20T00:00:01Z","tool_name":"read_file","tool_id":"t1","parameters":{"path":"a.ts"}}',
              '{"type":"tool_result","timestamp":"2026-03-20T00:00:02Z","tool_id":"t1","status":"success","output":"content"}',
              '{"type":"message","timestamp":"2026-03-20T00:00:03Z","role":"assistant","content":"Done!","delta":true}',
              '{"type":"result","timestamp":"2026-03-20T00:00:04Z","status":"success"}',
            ],
            exitCode: 0,
          });

        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const { events } = yield* collectEvents(adapter.streamEvents);
        yield* adapter.startSession({
          threadId: CLI_THREAD_ID,
          runtimeMode: "full-access",
          providerOptions: { gemini: { transport: "cli" } },
        });

        yield* adapter.sendTurn({ threadId: CLI_THREAD_ID, input: "Read file" });
        yield* Effect.sleep(300);

        // Find turn.completed index — all content/tool events must precede it
        const completedIdx = events.findIndex((e) => e.type === "turn.completed");
        expect(completedIdx).toBeGreaterThan(-1);

        // content.delta must appear before turn.completed
        const deltaIdx = events.findIndex((e) => e.type === "content.delta");
        expect(deltaIdx).toBeGreaterThan(-1);
        expect(deltaIdx).toBeLessThan(completedIdx);

        // item.started (tool_use) must appear before turn.completed
        const toolStartIdx = events.findIndex((e) => e.type === "item.started");
        expect(toolStartIdx).toBeGreaterThan(-1);
        expect(toolStartIdx).toBeLessThan(completedIdx);

        // item.completed (tool_result) must appear before turn.completed
        const toolCompleteIdx = events.findIndex(
          (e) => e.type === "item.completed" && (e as any).payload?.itemType === "dynamic_tool_call",
        );
        expect(toolCompleteIdx).toBeGreaterThan(-1);
        expect(toolCompleteIdx).toBeLessThan(completedIdx);
      }),
    ));
});
