import { describe, expect, it } from "vitest";

import {
  buildOpenAiCloudSummaryNotConfigured,
  buildOpenAiCloudSummarySuccess,
  dashboardCloudDateRange,
  emptyDashboardCloudSummary,
} from "./dashboardCloudDomain.ts";

describe("dashboardCloudDateRange", () => {
  it("computes an inclusive UTC date range with an exclusive unix end bound", () => {
    expect(dashboardCloudDateRange("7d", new Date("2026-03-20T12:00:00.000Z"))).toEqual({
      dateFrom: "2026-03-14",
      dateTo: "2026-03-20",
      startTimeUnixSeconds: 1_773_446_400,
      endTimeUnixSecondsExclusive: 1_774_051_200,
    });
  });
});

describe("dashboardCloudDomain", () => {
  it("returns an empty cloud summary when no provider syncs are enabled", () => {
    expect(emptyDashboardCloudSummary()).toEqual({
      source: "cloud_account",
      providers: [],
      accounts: [],
    });
  });

  it("builds a setup notice when the OpenAI admin key is missing", () => {
    const result = buildOpenAiCloudSummaryNotConfigured({
      organizationName: "Acme AI",
      organizationId: "org-acme",
    });

    expect(result.providers).toEqual([
      {
        provider: "codex",
        enabled: true,
        syncStatus: "not-configured",
        coverage: "api-only",
        scopeType: "organization",
        scopeDisplayName: "Acme AI",
        message: "Set XBECODE_OPENAI_ADMIN_KEY to enable OpenAI organization usage sync.",
        lastSyncAt: null,
        lastSyncError: null,
      },
    ]);
    expect(result.accounts).toEqual([]);
  });

  it("aggregates OpenAI usage and costs into one cloud account summary", () => {
    const result = buildOpenAiCloudSummarySuccess({
      period: "7d",
      organizationName: "Acme AI",
      organizationId: "org-acme",
      lastSyncAt: "2026-03-20T10:00:00.000Z",
      now: new Date("2026-03-20T12:00:00.000Z"),
      usagePayloads: [
        {
          object: "page",
          has_more: false,
          next_page: null,
          data: [
            {
              object: "bucket",
              start_time: 1,
              end_time: 2,
              results: [
                {
                  object: "organization.usage.completions.result",
                  model: "gpt-5.4",
                  input_tokens: 1200,
                  output_tokens: 300,
                  num_model_requests: 4,
                },
                {
                  object: "organization.usage.completions.result",
                  model: "gpt-4.1",
                  input_tokens: 500,
                  output_tokens: 100,
                  num_model_requests: 2,
                },
              ],
            },
            {
              object: "bucket",
              start_time: 2,
              end_time: 3,
              results: [
                {
                  object: "organization.usage.completions.result",
                  model: "gpt-5.4",
                  input_tokens: 800,
                  output_tokens: 200,
                  num_model_requests: 3,
                },
              ],
            },
          ],
        },
      ],
      costPayloads: [
        {
          object: "page",
          has_more: false,
          next_page: null,
          data: [
            {
              object: "bucket",
              start_time: 1,
              end_time: 2,
              results: [
                {
                  object: "organization.costs.result",
                  amount: { value: 1.25, currency: "usd" },
                },
              ],
            },
            {
              object: "bucket",
              start_time: 2,
              end_time: 3,
              results: [
                {
                  object: "organization.costs.result",
                  amount: { value: 0.75, currency: "usd" },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.providers[0]).toEqual({
      provider: "codex",
      enabled: true,
      syncStatus: "ready",
      coverage: "api-only",
      scopeType: "organization",
      scopeDisplayName: "Acme AI",
      message: null,
      lastSyncAt: "2026-03-20T10:00:00.000Z",
      lastSyncError: null,
    });

    expect(result.accounts[0]).toEqual({
      source: "cloud_account",
      provider: "codex",
      accountId: "org-acme",
      accountName: "Acme AI",
      scopeType: "organization",
      scopeId: "org-acme",
      scopeDisplayName: "Acme AI",
      coverage: "api-only",
      syncStatus: "ready",
      period: { from: "2026-03-14", to: "2026-03-20" },
      lastSyncAt: "2026-03-20T10:00:00.000Z",
      lastSyncError: null,
      spendUsd: 2,
      currency: "usd",
      inputTokens: 2_500,
      outputTokens: 600,
      totalTokens: 3_100,
      requestCount: 9,
      models: [
        {
          model: "gpt-5.4",
          inputTokens: 2_000,
          outputTokens: 500,
          totalTokens: 2_500,
          requestCount: 7,
          costUsd: null,
        },
        {
          model: "gpt-4.1",
          inputTokens: 500,
          outputTokens: 100,
          totalTokens: 600,
          requestCount: 2,
          costUsd: null,
        },
      ],
    });
  });
});
