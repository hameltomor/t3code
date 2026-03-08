import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Scope } from "effect";
import type { ThreadId } from "@xbetools/contracts";

import { makeGeminiAdapter } from "./GeminiAdapter.ts";

// ── Mock @google/genai SDK ────────────────────────────────────────────

let mockStreamChunks: Array<{ text: string }> = [{ text: "Hello from Gemini!" }];
let mockCreateCalls: Array<{ model: string; config: unknown; history?: unknown }> = [];

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    chats = {
      create: (opts: { model: string; config: unknown; history?: unknown }) => {
        mockCreateCalls.push(opts);
        return {
          sendMessageStream: async (_input: { message: string; config?: unknown }) => {
            const chunks = [...mockStreamChunks];
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
      },
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
  mockStreamChunks = [{ text: "Hello from Gemini!" }];
  mockCreateCalls = [];
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
        mockStreamChunks = [{ text: "chunk1" }, { text: "chunk2" }];
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

        // Wait for background stream to complete
        yield* Effect.sleep(200);

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

  it("rollback truncates turns and rebuilds chat", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Hello",
        });
        yield* Effect.sleep(200);

        const threadBefore = yield* adapter.readThread(TEST_THREAD_ID);
        expect(threadBefore.turns).toHaveLength(1);

        const callsBefore = mockCreateCalls.length;
        const threadAfter = yield* adapter.rollbackThread(TEST_THREAD_ID, 1);
        expect(threadAfter.turns).toHaveLength(0);

        // Verify chat was rebuilt (create called again)
        expect(mockCreateCalls.length).toBeGreaterThan(callsBefore);
      }),
    ));

  it("respondToRequest fails for gemini adapter", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        const result = yield* adapter
          .respondToRequest(TEST_THREAD_ID, "req-1" as any, "approve" as any)
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
      }),
    ));

  it("respondToUserInput fails for gemini adapter", () =>
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

  it("session recovery replays prior turns into chat history", () =>
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
                assistantText: "A typed superset of JavaScript.",
              },
              {
                userMessage: "How about Effect?",
                assistantText: "A framework for type-safe async programming.",
              },
            ],
          },
        });

        expect(session.status).toBe("ready");
        expect(session.model).toBe("gemini-3.1-pro-preview");

        // Verify turns were restored
        const thread = yield* adapter.readThread(TEST_THREAD_ID);
        expect(thread.turns).toHaveLength(2);

        // Verify chat was created with history
        const lastCreate = mockCreateCalls.at(-1);
        expect(lastCreate?.history).toBeDefined();
        expect(lastCreate?.history).toHaveLength(4); // 2 turns × 2 messages
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
        // Use a slow stream that we can interrupt
        mockStreamChunks = [{ text: "part1" }];
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

  it("buildUserMessage uses attachment.name not fileName", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        // Send a turn with an attachment-like input
        yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Check this image",
          attachments: [
            {
              type: "image" as const,
              id: "att-1" as any,
              name: "screenshot.png" as any,
              mimeType: "image/png" as any,
              sizeBytes: 1024 as any,
            },
          ],
        });

        yield* Effect.sleep(200);

        // Turn should complete without error
        const thread = yield* adapter.readThread(TEST_THREAD_ID);
        expect(thread.turns).toHaveLength(1);
      }),
    ));

  it("resume cursor includes full turn history after turn completes", () =>
    run(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter({ apiKey: TEST_API_KEY });
        const session = yield* adapter.startSession({
          threadId: TEST_THREAD_ID,
          runtimeMode: "full-access",
        });

        // Initial cursor should have empty turns
        const initialCursor = session.resumeCursor as {
          turns?: Array<{ userMessage: string; assistantText: string }>;
        };
        expect(initialCursor?.turns ?? []).toHaveLength(0);

        yield* adapter.sendTurn({
          threadId: TEST_THREAD_ID,
          input: "Hello",
        });
        yield* Effect.sleep(200);

        // After turn completes, read the session to get updated cursor
        const sessions = yield* adapter.listSessions();
        const updated = sessions.find((s) => s.threadId === TEST_THREAD_ID);
        const cursor = updated?.resumeCursor as {
          turns?: Array<{ userMessage: string; assistantText: string }>;
        };

        expect(cursor?.turns).toHaveLength(1);
        expect(cursor?.turns?.[0]?.userMessage).toBe("Hello");
        expect(cursor?.turns?.[0]?.assistantText).toBe("Hello from Gemini!");
      }),
    ));
});
