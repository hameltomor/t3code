/**
 * Dashboard contracts — schemas for usage tracking, rate limits, and provider status.
 *
 * @module Dashboard
 */
import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const DashboardMetricSource = Schema.Literals([
  "local_runtime",
  "cloud_account",
  "merged_view",
]);
export type DashboardMetricSource = typeof DashboardMetricSource.Type;

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
  source: DashboardMetricSource,
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
// Cloud Account Summary
// ---------------------------------------------------------------------------

export const DashboardCloudScopeType = Schema.Literals([
  "organization",
  "workspace",
  "billingAccount",
  "cloudProject",
  "project",
  "user",
  "subscription",
]);
export type DashboardCloudScopeType = typeof DashboardCloudScopeType.Type;

export const DashboardCloudCoverage = Schema.Literals([
  "full-account",
  "api-only",
  "claude-code-only",
  "billing-only",
  "project-only",
  "local-only",
]);
export type DashboardCloudCoverage = typeof DashboardCloudCoverage.Type;

export const DashboardCloudSyncStatus = Schema.Literals([
  "disabled",
  "not-configured",
  "ready",
  "error",
]);
export type DashboardCloudSyncStatus = typeof DashboardCloudSyncStatus.Type;

export const DashboardCloudProviderSync = Schema.Struct({
  provider: ProviderKind,
  enabled: Schema.Boolean,
  syncStatus: DashboardCloudSyncStatus,
  coverage: DashboardCloudCoverage,
  scopeType: DashboardCloudScopeType,
  scopeDisplayName: TrimmedNonEmptyString,
  message: Schema.NullOr(Schema.String),
  lastSyncAt: Schema.NullOr(IsoDateTime),
  lastSyncError: Schema.NullOr(Schema.String),
});
export type DashboardCloudProviderSync = typeof DashboardCloudProviderSync.Type;

export const DashboardCloudModelUsage = Schema.Struct({
  model: TrimmedNonEmptyString,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  requestCount: Schema.Number,
  costUsd: Schema.NullOr(Schema.Number),
});
export type DashboardCloudModelUsage = typeof DashboardCloudModelUsage.Type;

export const DashboardCloudAccountSummary = Schema.Struct({
  source: Schema.Literal("cloud_account"),
  provider: ProviderKind,
  accountId: TrimmedNonEmptyString,
  accountName: TrimmedNonEmptyString,
  scopeType: DashboardCloudScopeType,
  scopeId: TrimmedNonEmptyString,
  scopeDisplayName: TrimmedNonEmptyString,
  coverage: DashboardCloudCoverage,
  syncStatus: DashboardCloudSyncStatus,
  period: Schema.Struct({
    from: Schema.String,
    to: Schema.String,
  }),
  lastSyncAt: Schema.NullOr(IsoDateTime),
  lastSyncError: Schema.NullOr(Schema.String),
  spendUsd: Schema.NullOr(Schema.Number),
  currency: Schema.NullOr(TrimmedNonEmptyString),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalTokens: Schema.Number,
  requestCount: Schema.Number,
  models: Schema.Array(DashboardCloudModelUsage),
});
export type DashboardCloudAccountSummary = typeof DashboardCloudAccountSummary.Type;

export const DashboardCloudSummary = Schema.Struct({
  source: Schema.Literal("cloud_account"),
  providers: Schema.Array(DashboardCloudProviderSync),
  accounts: Schema.Array(DashboardCloudAccountSummary),
});
export type DashboardCloudSummary = typeof DashboardCloudSummary.Type;

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
  status: Schema.Literals(["connected", "disconnected", "warning", "error", "unconfigured"]),
  authStatus: Schema.Literals(["authenticated", "unauthenticated", "unknown"]),
  activeSessionCount: Schema.Number,
  lastError: Schema.NullOr(Schema.String),
});
export type DashboardProviderStatus = typeof DashboardProviderStatus.Type;

// ---------------------------------------------------------------------------
// WS Request Inputs
// ---------------------------------------------------------------------------

export const DashboardGetUsageSummaryInput = Schema.Struct({
  period: DashboardUsagePeriod,
});
export type DashboardGetUsageSummaryInput = typeof DashboardGetUsageSummaryInput.Type;

// ---------------------------------------------------------------------------
// WS Method types
// ---------------------------------------------------------------------------

export const DASHBOARD_WS_METHODS = {
  getUsageSummary: "dashboard.getUsageSummary",
  getCloudSummary: "dashboard.getCloudSummary",
  getRateLimits: "dashboard.getRateLimits",
  getProviderStatus: "dashboard.getProviderStatus",
} as const;
