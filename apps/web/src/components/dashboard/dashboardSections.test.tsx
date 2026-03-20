import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CloudAccountsSection } from "./CloudAccountsSection";
import { ProviderStatusSection } from "./ProviderStatusSection";
import { RateLimitsSection } from "./RateLimitsSection";

describe("dashboard sections", () => {
  it("renders provider authentication state without API-key-specific copy", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusSection
        providerStatus={[
          {
            provider: "claudeCode",
            status: "warning",
            authStatus: "unknown",
            activeSessionCount: 0,
            lastError: "Claude Code readiness is determined at runtime when a session starts.",
          },
        ]}
      />,
    );

    expect(markup).toContain("Authentication");
    expect(markup).toContain("Needs attention");
    expect(markup).not.toContain("API Key");
  });

  it("renders retry-after copy when only cooldown timing is available", () => {
    const markup = renderToStaticMarkup(
      <RateLimitsSection
        rateLimits={[
          {
            provider: "claudeCode",
            requestsPerMinute: null,
            tokensPerMinute: null,
            tokensPerDay: null,
            retryAfterMs: 4_500,
            updatedAt: "2026-03-20T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("No live rate limit counters exposed by this provider yet");
    expect(markup).toContain("Retry window resets in 5s");
  });

  it("renders synced cloud account cards with provider-reported totals", () => {
    const markup = renderToStaticMarkup(
      <CloudAccountsSection
        cloud={{
          source: "cloud_account",
          providers: [
            {
              provider: "codex",
              enabled: true,
              syncStatus: "ready",
              coverage: "api-only",
              scopeType: "organization",
              scopeDisplayName: "Acme AI",
              message: null,
              lastSyncAt: "2026-03-20T10:00:00.000Z",
              lastSyncError: null,
            },
          ],
          accounts: [
            {
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
              spendUsd: 12.34,
              currency: "usd",
              inputTokens: 10_000,
              outputTokens: 3_000,
              totalTokens: 13_000,
              requestCount: 44,
              models: [
                {
                  model: "gpt-5.4",
                  inputTokens: 7_000,
                  outputTokens: 2_000,
                  totalTokens: 9_000,
                  requestCount: 20,
                  costUsd: null,
                },
                {
                  model: "gpt-4.1",
                  inputTokens: 3_000,
                  outputTokens: 1_000,
                  totalTokens: 4_000,
                  requestCount: 24,
                  costUsd: null,
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("Cloud Accounts");
    expect(markup).toContain("Acme AI");
    expect(markup).toContain("OpenAI / Codex");
    expect(markup).toContain("$12.34");
    expect(markup).toContain("gpt-5.4");
  });

  it("renders setup guidance when cloud sync is enabled but not configured", () => {
    const markup = renderToStaticMarkup(
      <CloudAccountsSection
        cloud={{
          source: "cloud_account",
          providers: [
            {
              provider: "codex",
              enabled: true,
              syncStatus: "not-configured",
              coverage: "api-only",
              scopeType: "organization",
              scopeDisplayName: "OpenAI API organization",
              message: "Set XBECODE_OPENAI_ADMIN_KEY to enable OpenAI organization usage sync.",
              lastSyncAt: null,
              lastSyncError: null,
            },
          ],
          accounts: [],
        }}
      />,
    );

    expect(markup).toContain("Needs setup");
    expect(markup).toContain("XBECODE_OPENAI_ADMIN_KEY");
  });
});
