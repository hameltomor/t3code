import type {
  DashboardProviderStatus,
  NormalizedTokenUsage,
  OrchestrationThreadContextStatus,
  ProviderSession,
  ServerProviderStatus,
} from "@xbetools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildDashboardProviderStatuses,
  dashboardDateRange,
  deriveDashboardUsageRecord,
  normalizeDashboardRateLimit,
} from "./dashboardDomain.ts";

function makeContextStatus(
  overrides: Partial<OrchestrationThreadContextStatus>,
): OrchestrationThreadContextStatus {
  return {
    provider: "codex",
    support: "native",
    source: "provider-event",
    freshness: "live",
    status: "ok",
    model: "gpt-5.3-codex",
    tokenUsage: {
      totalTokens: 100,
      inputTokens: 70,
      outputTokens: 30,
    },
    measuredAt: "2026-03-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("dashboardDateRange", () => {
  it("computes the expected rolling 7d range", () => {
    expect(dashboardDateRange("7d", new Date("2026-03-20T12:00:00.000Z"))).toEqual({
      dateFrom: "2026-03-14",
      dateTo: "2026-03-20",
    });
  });
});

describe("deriveDashboardUsageRecord", () => {
  it("uses the first Codex cumulative snapshot as the initial usage delta", () => {
    const result = deriveDashboardUsageRecord({
      contextStatus: makeContextStatus({
        tokenUsage: {
          totalTokens: 6200,
          inputTokens: 5000,
          outputTokens: 1200,
          cachedInputTokens: 900,
          reasoningTokens: 100,
        },
      }),
      previousTokenUsage: null,
    });

    expect(result).toEqual({
      totalTokens: 6200,
      inputTokens: 5000,
      outputTokens: 1200,
      cachedInputTokens: 900,
      reasoningTokens: 100,
    });
  });

  it("computes deltas for Codex cumulative usage", () => {
    const previous: NormalizedTokenUsage = {
      totalTokens: 6200,
      inputTokens: 5000,
      outputTokens: 1200,
      cachedInputTokens: 900,
      reasoningTokens: 100,
    };

    const result = deriveDashboardUsageRecord({
      contextStatus: makeContextStatus({
        tokenUsage: {
          totalTokens: 9100,
          inputTokens: 7000,
          outputTokens: 2100,
          cachedInputTokens: 1200,
          reasoningTokens: 250,
        },
      }),
      previousTokenUsage: previous,
    });

    expect(result).toEqual({
      totalTokens: 2900,
      inputTokens: 2000,
      outputTokens: 900,
      cachedInputTokens: 300,
      reasoningTokens: 150,
    });
  });

  it("drops repeated Codex cumulative snapshots", () => {
    const previous: NormalizedTokenUsage = {
      totalTokens: 6200,
      inputTokens: 5000,
      outputTokens: 1200,
    };

    const result = deriveDashboardUsageRecord({
      contextStatus: makeContextStatus({
        tokenUsage: previous,
      }),
      previousTokenUsage: previous,
    });

    expect(result).toBeNull();
  });

  it("drops Codex compaction resets from usage accounting", () => {
    const result = deriveDashboardUsageRecord({
      contextStatus: makeContextStatus({
        tokenUsage: {
          totalTokens: 1400,
          inputTokens: 1000,
          outputTokens: 400,
        },
      }),
      previousTokenUsage: {
        totalTokens: 6200,
        inputTokens: 5000,
        outputTokens: 1200,
      },
    });

    expect(result).toBeNull();
  });

  it("records SDK usage sources as incremental usage", () => {
    const incrementalUsage: NormalizedTokenUsage = {
      totalTokens: 1800,
      inputTokens: 1200,
      outputTokens: 600,
    };

    const result = deriveDashboardUsageRecord({
      contextStatus: makeContextStatus({
        provider: "claudeCode",
        support: "derived-live",
        source: "sdk-usage",
        model: "claude-sonnet-4-6",
        tokenUsage: incrementalUsage,
      }),
      previousTokenUsage: {
        totalTokens: 999999,
      },
    });

    expect(result).toEqual(incrementalUsage);
  });

  it("ignores compact-boundary events for usage accounting", () => {
    const result = deriveDashboardUsageRecord({
      contextStatus: makeContextStatus({
        provider: "claudeCode",
        support: "derived-live",
        source: "compact-boundary",
        tokenUsage: {
          totalTokens: 32000,
        },
      }),
      previousTokenUsage: null,
    });

    expect(result).toBeNull();
  });
});

describe("normalizeDashboardRateLimit", () => {
  it("normalizes a generic nested provider payload", () => {
    const result = normalizeDashboardRateLimit({
      provider: "codex",
      raw: {
        rpm: { limit: 100, remaining: 20 },
        token_limits: {
          tpm: { limit: 1000, used: 450 },
          daily_tokens: { limit: 5000, available: 1250 },
        },
        retry_after_ms: 1500,
      },
      updatedAt: "2026-03-20T10:00:00.000Z",
      now: new Date("2026-03-20T10:00:00.000Z"),
    });

    expect(result).toEqual({
      provider: "codex",
      requestsPerMinute: { used: 80, limit: 100 },
      tokensPerMinute: { used: 450, limit: 1000 },
      tokensPerDay: { used: 3750, limit: 5000 },
      retryAfterMs: 1500,
      updatedAt: "2026-03-20T10:00:00.000Z",
    });
  });

  it("normalizes Claude rate_limit_event payloads without inventing counters", () => {
    const result = normalizeDashboardRateLimit({
      provider: "claudeCode",
      raw: {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "warning",
          resetsAt: 1_900_000_001,
        },
      },
      updatedAt: "2026-03-20T10:00:00.000Z",
      now: new Date("2026-03-20T10:00:00.000Z"),
    });

    expect(result.provider).toBe("claudeCode");
    expect(result.requestsPerMinute).toBeNull();
    expect(result.tokensPerMinute).toBeNull();
    expect(result.tokensPerDay).toBeNull();
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("buildDashboardProviderStatuses", () => {
  it("builds stable provider rows across health and live sessions", () => {
    const healthStatuses: ReadonlyArray<ServerProviderStatus> = [
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: "2026-03-20T10:00:00.000Z",
      },
      {
        provider: "claudeCode",
        status: "warning",
        available: true,
        authStatus: "unknown",
        checkedAt: "2026-03-20T10:00:00.000Z",
        message: "Claude Code readiness is determined at runtime when a session starts.",
      },
      {
        provider: "gemini",
        status: "error",
        available: false,
        authStatus: "unauthenticated",
        checkedAt: "2026-03-20T10:00:00.000Z",
        message: "No Gemini API key found.",
      },
    ];
    const sessions: ReadonlyArray<ProviderSession> = [
      {
        provider: "codex",
        status: "running",
        runtimeMode: "full-access",
        model: "gpt-5.3-codex",
        createdAt: "2026-03-20T10:00:00.000Z",
        updatedAt: "2026-03-20T10:01:00.000Z",
      },
    ];

    const result = buildDashboardProviderStatuses({
      healthStatuses,
      sessions,
    });

    expect(result).toEqual([
      {
        provider: "codex",
        status: "connected",
        authStatus: "authenticated",
        activeSessionCount: 1,
        lastError: null,
      },
      {
        provider: "claudeCode",
        status: "warning",
        authStatus: "unknown",
        activeSessionCount: 0,
        lastError: "Claude Code readiness is determined at runtime when a session starts.",
      },
      {
        provider: "gemini",
        status: "unconfigured",
        authStatus: "unauthenticated",
        activeSessionCount: 0,
        lastError: "No Gemini API key found.",
      },
    ] satisfies ReadonlyArray<DashboardProviderStatus>);
  });
});
