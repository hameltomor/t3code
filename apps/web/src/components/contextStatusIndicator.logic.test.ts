import type { OrchestrationThreadContextStatus } from "@xbetools/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveContextStatusDisplay,
  deriveContextThreshold,
} from "./contextStatusIndicator.logic";

function makeContextStatus(
  overrides: Partial<OrchestrationThreadContextStatus> = {},
): OrchestrationThreadContextStatus {
  return {
    provider: "codex" as const,
    support: "native" as const,
    source: "provider-event" as const,
    freshness: "live" as const,
    status: "ok" as const,
    model: "gpt-5.3-codex",
    tokenUsage: { totalTokens: 5000 },
    percent: 42,
    measuredAt: new Date().toISOString(),
    ...overrides,
  } as OrchestrationThreadContextStatus;
}

describe("deriveContextThreshold", () => {
  it("returns neutral for undefined percent", () => {
    expect(deriveContextThreshold(undefined)).toBe("neutral");
  });

  it("returns neutral for 0%", () => {
    expect(deriveContextThreshold(0)).toBe("neutral");
  });

  it("returns neutral for 69%", () => {
    expect(deriveContextThreshold(69)).toBe("neutral");
  });

  it("returns watch at 70%", () => {
    expect(deriveContextThreshold(70)).toBe("watch");
  });

  it("returns watch at 84%", () => {
    expect(deriveContextThreshold(84)).toBe("watch");
  });

  it("returns warning at 85%", () => {
    expect(deriveContextThreshold(85)).toBe("warning");
  });

  it("returns warning at 94%", () => {
    expect(deriveContextThreshold(94)).toBe("warning");
  });

  it("returns danger at 95%", () => {
    expect(deriveContextThreshold(95)).toBe("danger");
  });

  it("returns danger at 100%", () => {
    expect(deriveContextThreshold(100)).toBe("danger");
  });
});

describe("deriveContextStatusDisplay", () => {
  const nowMs = Date.now();

  it("returns invisible when sessionActive is false", () => {
    const result = deriveContextStatusDisplay(makeContextStatus(), false, nowMs);
    expect(result.visible).toBe(false);
  });

  it("returns invisible when contextStatus is null", () => {
    const result = deriveContextStatusDisplay(null, true, nowMs);
    expect(result.visible).toBe(false);
  });

  it("returns 'Context unknown' when percent is undefined", () => {
    const result = deriveContextStatusDisplay(
      makeContextStatus({ percent: undefined }),
      true,
      nowMs,
    );
    expect(result.visible).toBe(true);
    expect(result.label).toBe("Context unknown");
  });

  it("returns 'Context XX%' with rounded percent", () => {
    const result = deriveContextStatusDisplay(
      makeContextStatus({ percent: 42.7 }),
      true,
      nowMs,
    );
    expect(result.label).toBe("Context 43%");
  });

  it("derives correct threshold from percent", () => {
    const result = deriveContextStatusDisplay(
      makeContextStatus({ percent: 86 }),
      true,
      nowMs,
    );
    expect(result.threshold).toBe("warning");
  });

  it("detects compacted recently when lastCompactedAt is within 5 minutes", () => {
    const twoMinAgo = new Date(nowMs - 2 * 60 * 1000).toISOString();
    const result = deriveContextStatusDisplay(
      makeContextStatus({ lastCompactedAt: twoMinAgo }),
      true,
      nowMs,
    );
    expect(result.compactedRecently).toBe(true);
  });

  it("does not flag compacted when lastCompactedAt is older than 5 minutes", () => {
    const tenMinAgo = new Date(nowMs - 10 * 60 * 1000).toISOString();
    const result = deriveContextStatusDisplay(
      makeContextStatus({ lastCompactedAt: tenMinAgo }),
      true,
      nowMs,
    );
    expect(result.compactedRecently).toBe(false);
  });

  it("detects stale freshness", () => {
    const result = deriveContextStatusDisplay(
      makeContextStatus({ freshness: "stale" }),
      true,
      nowMs,
    );
    expect(result.isStale).toBe(true);
  });

  it("does not flag stale for live freshness", () => {
    const result = deriveContextStatusDisplay(
      makeContextStatus({ freshness: "live" }),
      true,
      nowMs,
    );
    expect(result.isStale).toBe(false);
  });

  it("computes lastUpdatedLabel as relative time when stale", () => {
    const threeMinAgo = new Date(nowMs - 3 * 60 * 1000).toISOString();
    const result = deriveContextStatusDisplay(
      makeContextStatus({ freshness: "stale", measuredAt: threeMinAgo }),
      true,
      nowMs,
    );
    expect(result.lastUpdatedLabel).not.toBeNull();
    expect(result.lastUpdatedLabel).toContain("3m ago");
  });
});
