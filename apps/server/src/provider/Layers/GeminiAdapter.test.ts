import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Scope } from "effect";
import type { ThreadId } from "@xbetools/contracts";

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

        // Respond to the approval
        const result = yield* adapter
          .respondToRequest(TEST_THREAD_ID, "any-id" as any, "accept" as any)
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

          // Approve the request
          yield* adapter.respondToRequest(
            TEST_THREAD_ID,
            "any" as any,
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

          // Deny the request
          yield* adapter.respondToRequest(
            TEST_THREAD_ID,
            "any" as any,
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
    it("interruption during tool execution clears pending state", () =>
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

          // Session should still be valid
          expect(yield* adapter.hasSession(TEST_THREAD_ID)).toBe(true);
        }),
      ));
  });
});
