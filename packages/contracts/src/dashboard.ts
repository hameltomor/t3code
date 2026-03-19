/**
 * Dashboard contracts — schemas for usage tracking, rate limits, and provider status.
 *
 * @module Dashboard
 */
import { Schema } from "effect";

import { ProviderKind } from "./orchestration";

// ---------------------------------------------------------------------------
// Usage Summary
// ---------------------------------------------------------------------------

export const DashboardProviderUsage = Schema.Struct({
  provider: ProviderKind,
  totalTokens: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  turnCount: Schema.Number,
});
export type DashboardProviderUsage = typeof DashboardProviderUsage.Type;

export const DashboardTopModel = Schema.Struct({
  model: Schema.String,
  provider: ProviderKind,
  totalTokens: Schema.Number,
  turnCount: Schema.Number,
});
export type DashboardTopModel = typeof DashboardTopModel.Type;

export const DashboardDailyUsage = Schema.Struct({
  date: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  turnCount: Schema.Number,
});
export type DashboardDailyUsage = typeof DashboardDailyUsage.Type;

export const DashboardUsagePeriod = Schema.Literals([
  "today",
  "7d",
  "30d",
  "all",
]);
export type DashboardUsagePeriod = typeof DashboardUsagePeriod.Type;

export const DashboardUsageSummary = Schema.Struct({
  providers: Schema.Array(DashboardProviderUsage),
  topModels: Schema.Array(DashboardTopModel),
  dailyTotals: Schema.Array(DashboardDailyUsage),
  period: Schema.Struct({
    from: Schema.String,
    to: Schema.String,
  }),
});
export type DashboardUsageSummary = typeof DashboardUsageSummary.Type;

// ---------------------------------------------------------------------------
// Rate Limits
// ---------------------------------------------------------------------------

export const RateLimitEntry = Schema.Struct({
  used: Schema.Number,
  limit: Schema.Number,
});
export type RateLimitEntry = typeof RateLimitEntry.Type;

export const DashboardRateLimit = Schema.Struct({
  provider: ProviderKind,
  requestsPerMinute: Schema.NullOr(RateLimitEntry),
  tokensPerMinute: Schema.NullOr(RateLimitEntry),
  tokensPerDay: Schema.NullOr(RateLimitEntry),
  retryAfterMs: Schema.NullOr(Schema.Number),
  updatedAt: Schema.String,
});
export type DashboardRateLimit = typeof DashboardRateLimit.Type;

// ---------------------------------------------------------------------------
// Provider Status
// ---------------------------------------------------------------------------

export const DashboardProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: Schema.Literals(["connected", "disconnected", "error", "unconfigured"]),
  hasApiKey: Schema.Boolean,
  activeSessionCount: Schema.Number,
  lastError: Schema.NullOr(Schema.String),
});
export type DashboardProviderStatus = typeof DashboardProviderStatus.Type;

// ---------------------------------------------------------------------------
// WS Method types
// ---------------------------------------------------------------------------

export const DASHBOARD_WS_METHODS = {
  getUsageSummary: "dashboard.getUsageSummary",
  getRateLimits: "dashboard.getRateLimits",
  getProviderStatus: "dashboard.getProviderStatus",
} as const;

export const DASHBOARD_WS_CHANNELS = {
  rateLimitsUpdated: "dashboard.rateLimitsUpdated",
} as const;
