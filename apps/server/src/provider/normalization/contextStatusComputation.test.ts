import { describe, expect, it } from "vitest";
import type { OrchestrationThreadContextStatus } from "@xbetools/contracts";
import { computeContextStatus } from "./contextStatusComputation.ts";

function makePreviousStatus(
  overrides: Partial<OrchestrationThreadContextStatus> = {},
): OrchestrationThreadContextStatus {
  return {
    provider: "codex",
    support: "native",
    source: "provider-event",
    freshness: "live",
    status: "ok",
    model: "gpt-5.3-codex",
    tokenUsage: { totalTokens: 100000 },
    measuredAt: "2026-03-13T00:00:00.000Z",
    ...overrides,
  } as OrchestrationThreadContextStatus;
}

describe("computeContextStatus", () => {
  it("returns ok status for low token usage", () => {
    const result = computeContextStatus({
      provider: "codex",
      model: "gpt-5.3-codex",
      usage: { totalTokens: 50000, inputTokens: 40000, outputTokens: 10000 },
      support: "native",
      source: "provider-event",
      measuredAt: "2026-03-13T00:00:00.000Z",
    });

    expect(result.status).toBe("ok");
    expect(result.freshness).toBe("live");
  });

  it("returns watch status for 75-95% usage", () => {
    // gpt-5.3-codex has 400k limit; 320k = 80%
    const result = computeContextStatus({
      provider: "codex",
      model: "gpt-5.3-codex",
      usage: { totalTokens: 320000 },
      support: "native",
      source: "provider-event",
      measuredAt: "2026-03-13T00:00:00.000Z",
    });

    expect(result.status).toBe("watch");
  });

  it("returns near-limit status for >=95% usage", () => {
    // 390k / 400k = 97.5%
    const result = computeContextStatus({
      provider: "codex",
      model: "gpt-5.3-codex",
      usage: { totalTokens: 390000 },
      support: "native",
      source: "provider-event",
      measuredAt: "2026-03-13T00:00:00.000Z",
    });

    expect(result.status).toBe("near-limit");
  });

  it("detects compaction from compact-boundary source without large token drop", () => {
    // compact_boundary with pre_tokens=95k, previous was 100k (only 5% drop — heuristic would miss)
    const result = computeContextStatus({
      provider: "claudeCode",
      model: "claude-sonnet-4-20250514",
      usage: { totalTokens: 95000 },
      support: "derived-live",
      source: "compact-boundary",
      measuredAt: "2026-03-13T00:00:01.000Z",
      previousStatus: makePreviousStatus({
        provider: "claudeCode",
        support: "derived-live",
        source: "sdk-usage",
        status: "watch",
        tokenUsage: { totalTokens: 100000 },
      }),
    });

    expect(result.status).toBe("compacted");
    expect(result.compactionCount).toBe(1);
    expect(result.lastCompactionReason).toBe("compact-boundary");
    expect(result.lastCompactedAt).toBe("2026-03-13T00:00:01.000Z");
  });

  it("detects compaction from heuristic token drop without compact-boundary source", () => {
    // 30k / 380k = ~92% drop — heuristic triggers
    const result = computeContextStatus({
      provider: "codex",
      model: "gpt-5.3-codex",
      usage: { totalTokens: 30000 },
      support: "native",
      source: "provider-event",
      measuredAt: "2026-03-13T00:00:01.000Z",
      previousStatus: makePreviousStatus({
        status: "near-limit",
        tokenUsage: { totalTokens: 380000 },
      }),
    });

    expect(result.status).toBe("compacted");
    expect(result.lastCompactionReason).toBe("token-count-drop");
  });

  it("increments compaction count from previous status", () => {
    const result = computeContextStatus({
      provider: "claudeCode",
      model: "claude-sonnet-4-20250514",
      usage: { totalTokens: 50000 },
      support: "derived-live",
      source: "compact-boundary",
      measuredAt: "2026-03-13T00:00:02.000Z",
      previousStatus: makePreviousStatus({
        provider: "claudeCode",
        support: "derived-live",
        compactionCount: 2,
      }),
    });

    expect(result.compactionCount).toBe(3);
  });

  it("returns unknown status when model limit is not available", () => {
    const result = computeContextStatus({
      provider: "codex",
      model: "unknown-model-xyz",
      usage: { totalTokens: 50000 },
      support: "native",
      source: "provider-event",
      measuredAt: "2026-03-13T00:00:00.000Z",
    });

    expect(result.status).toBe("unknown");
    expect(result.percent).toBeUndefined();
  });
});
