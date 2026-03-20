import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import type { ThreadId, TurnId } from "@xbetools/contracts";
import {
  parseCliEvent,
  buildCliArgs,
  mapCliEventToRuntimeEvents,
  type GeminiCliEvent,
} from "./GeminiCliRuntime.ts";

describe("GeminiCliRuntime", () => {
  describe("parseCliEvent", () => {
    it("parses init event", () => {
      const event = parseCliEvent(
        '{"type":"init","timestamp":"2026-03-20T00:00:00Z","session_id":"abc","model":"gemini-3"}',
      );
      expect(event).toEqual({
        type: "init",
        timestamp: "2026-03-20T00:00:00Z",
        session_id: "abc",
        model: "gemini-3",
      });
    });

    it("parses message event with delta", () => {
      const event = parseCliEvent(
        '{"type":"message","timestamp":"2026-03-20T00:00:00Z","role":"assistant","content":"hello","delta":true}',
      );
      expect(event).toEqual({
        type: "message",
        timestamp: "2026-03-20T00:00:00Z",
        role: "assistant",
        content: "hello",
        delta: true,
      });
    });

    it("parses tool_use event", () => {
      const event = parseCliEvent(
        '{"type":"tool_use","timestamp":"2026-03-20T00:00:00Z","tool_name":"run_shell_command","tool_id":"t1","parameters":{"command":"ls"}}',
      );
      expect(event?.type).toBe("tool_use");
      if (event?.type === "tool_use") {
        expect(event.tool_name).toBe("run_shell_command");
        expect(event.tool_id).toBe("t1");
        expect(event.parameters).toEqual({ command: "ls" });
      }
    });

    it("parses tool_result event", () => {
      const event = parseCliEvent(
        '{"type":"tool_result","timestamp":"2026-03-20T00:00:00Z","tool_id":"t1","status":"success","output":"file.txt"}',
      );
      expect(event?.type).toBe("tool_result");
    });

    it("parses result event", () => {
      const event = parseCliEvent(
        '{"type":"result","timestamp":"2026-03-20T00:00:00Z","status":"success","stats":{"total_tokens":100}}',
      );
      expect(event?.type).toBe("result");
      if (event?.type === "result") {
        expect(event.status).toBe("success");
        expect(event.stats?.total_tokens).toBe(100);
      }
    });

    it("returns undefined for empty lines", () => {
      expect(parseCliEvent("")).toBeUndefined();
      expect(parseCliEvent("  ")).toBeUndefined();
    });

    it("returns undefined for non-JSON lines", () => {
      expect(parseCliEvent("not json")).toBeUndefined();
      expect(parseCliEvent("Shell cwd was reset")).toBeUndefined();
    });

    it("returns undefined for unknown event types", () => {
      expect(parseCliEvent('{"type":"unknown","data":123}')).toBeUndefined();
    });

    it("returns undefined for malformed JSON", () => {
      expect(parseCliEvent('{"type":"init"')).toBeUndefined();
    });

    it("returns undefined for JSON without type field", () => {
      expect(parseCliEvent('{"data":"test"}')).toBeUndefined();
    });
  });

  describe("buildCliArgs", () => {
    it("builds basic headless args", () => {
      const args = buildCliArgs({
        prompt: "hello",
        runtimeMode: "full-access",
      });
      expect(args).toEqual(["-p", "hello", "-o", "stream-json", "--approval-mode", "yolo"]);
    });

    it("adds model flag when specified", () => {
      const args = buildCliArgs({
        prompt: "hello",
        model: "gemini-2.5-flash",
        runtimeMode: "full-access",
      });
      expect(args).toContain("-m");
      expect(args).toContain("gemini-2.5-flash");
    });

    it("uses default approval mode for approval-required runtime", () => {
      const args = buildCliArgs({
        prompt: "hello",
        runtimeMode: "approval-required",
      });
      expect(args).toContain("--approval-mode");
      expect(args[args.indexOf("--approval-mode") + 1]).toBe("default");
    });

    it("uses yolo approval mode for full-access runtime", () => {
      const args = buildCliArgs({
        prompt: "hello",
        runtimeMode: "full-access",
      });
      expect(args[args.indexOf("--approval-mode") + 1]).toBe("yolo");
    });

    it("adds resume flag when specified", () => {
      const args = buildCliArgs({
        prompt: "hello",
        runtimeMode: "full-access",
        resumeSession: "latest",
      });
      expect(args).toContain("--resume");
      expect(args).toContain("latest");
    });
  });

  describe("mapCliEventToRuntimeEvents", () => {
    const ctx = {
      threadId: "thread-1" as ThreadId,
      turnId: "turn-1" as TurnId,
    };

    it("maps init event to session.configured", async () => {
      const event: GeminiCliEvent = {
        type: "init",
        timestamp: "2026-03-20T00:00:00Z",
        session_id: "abc",
        model: "gemini-3",
      };
      const events = await Effect.runPromise(mapCliEventToRuntimeEvents(event, ctx));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("session.configured");
    });

    it("maps assistant delta message to content.delta", async () => {
      const event: GeminiCliEvent = {
        type: "message",
        timestamp: "2026-03-20T00:00:00Z",
        role: "assistant",
        content: "hello",
        delta: true,
      };
      const events = await Effect.runPromise(mapCliEventToRuntimeEvents(event, ctx));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("content.delta");
    });

    it("returns empty array for user messages", async () => {
      const event: GeminiCliEvent = {
        type: "message",
        timestamp: "2026-03-20T00:00:00Z",
        role: "user",
        content: "hello",
      };
      const events = await Effect.runPromise(mapCliEventToRuntimeEvents(event, ctx));
      expect(events).toHaveLength(0);
    });

    it("maps tool_use event to item.started", async () => {
      const event: GeminiCliEvent = {
        type: "tool_use",
        timestamp: "2026-03-20T00:00:00Z",
        tool_name: "run_shell_command",
        tool_id: "t1",
        parameters: { command: "ls" },
      };
      const events = await Effect.runPromise(mapCliEventToRuntimeEvents(event, ctx));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("item.started");
    });

    it("maps tool_result event to item.completed", async () => {
      const event: GeminiCliEvent = {
        type: "tool_result",
        timestamp: "2026-03-20T00:00:00Z",
        tool_id: "t1",
        status: "success",
        output: "file.txt",
      };
      const events = await Effect.runPromise(mapCliEventToRuntimeEvents(event, ctx));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("item.completed");
    });

    it("maps result event to turn.completed", async () => {
      const event: GeminiCliEvent = {
        type: "result",
        timestamp: "2026-03-20T00:00:00Z",
        status: "success",
        stats: { total_tokens: 100 },
      };
      const events = await Effect.runPromise(mapCliEventToRuntimeEvents(event, ctx));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("turn.completed");
    });
  });
});
