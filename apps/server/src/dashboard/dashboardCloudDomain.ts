import type {
  DashboardCloudAccountSummary,
  DashboardCloudModelUsage,
  DashboardCloudProviderSync,
  DashboardCloudSummary,
  DashboardUsagePeriod,
} from "@xbetools/contracts";

import { dashboardDateRange } from "./dashboardDomain.ts";

interface OpenAiUsageResult {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestCount: number;
}

interface OpenAiCostResult {
  readonly value: number;
  readonly currency: string | null;
}

const OPENAI_CLOUD_SCOPE_FALLBACK = "OpenAI API organization";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizedNonEmpty(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function buildScopeDisplayName(organizationName?: string, organizationId?: string): string {
  return normalizedNonEmpty(
    organizationName,
    normalizedNonEmpty(organizationId, OPENAI_CLOUD_SCOPE_FALLBACK),
  );
}

export function dashboardCloudDateRange(
  period: DashboardUsagePeriod,
  now = new Date(),
): {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly startTimeUnixSeconds: number;
  readonly endTimeUnixSecondsExclusive: number;
} {
  const { dateFrom, dateTo } = dashboardDateRange(period, now);
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const endExclusive = new Date(`${dateTo}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return {
    dateFrom,
    dateTo,
    startTimeUnixSeconds: Math.floor(start.getTime() / 1_000),
    endTimeUnixSecondsExclusive: Math.floor(endExclusive.getTime() / 1_000),
  };
}

function parseOpenAiUsageResults(payloads: ReadonlyArray<unknown>): ReadonlyArray<OpenAiUsageResult> {
  const results: Array<OpenAiUsageResult> = [];

  for (const payload of payloads) {
    const page = asRecord(payload);
    if (!page) continue;

    for (const bucketValue of asArray(page.data)) {
      const bucket = asRecord(bucketValue);
      if (!bucket) continue;

      for (const resultValue of asArray(bucket.results)) {
        const result = asRecord(resultValue);
        if (!result) continue;

        const inputTokens = asFiniteNumber(result.input_tokens) ?? 0;
        const outputTokens = asFiniteNumber(result.output_tokens) ?? 0;
        const requestCount = asFiniteNumber(result.num_model_requests) ?? 0;
        const totalTokens = inputTokens + outputTokens;
        if (totalTokens <= 0 && requestCount <= 0) continue;

        results.push({
          model: normalizedNonEmpty(asString(result.model), "unknown"),
          inputTokens,
          outputTokens,
          requestCount,
        });
      }
    }
  }

  return results;
}

function parseOpenAiCosts(payloads: ReadonlyArray<unknown>): ReadonlyArray<OpenAiCostResult> {
  const results: Array<OpenAiCostResult> = [];

  for (const payload of payloads) {
    const page = asRecord(payload);
    if (!page) continue;

    for (const bucketValue of asArray(page.data)) {
      const bucket = asRecord(bucketValue);
      if (!bucket) continue;

      for (const resultValue of asArray(bucket.results)) {
        const result = asRecord(resultValue);
        if (!result) continue;

        const amount = asRecord(result.amount);
        const value = asFiniteNumber(amount?.value);
        if (value === null) continue;

        results.push({
          value,
          currency: asString(amount?.currency)?.toLowerCase() ?? null,
        });
      }
    }
  }

  return results;
}

function aggregateOpenAiModelUsage(
  usageResults: ReadonlyArray<OpenAiUsageResult>,
): ReadonlyArray<DashboardCloudModelUsage> {
  const byModel = new Map<string, DashboardCloudModelUsage>();

  for (const result of usageResults) {
    const current = byModel.get(result.model);
    if (current) {
      byModel.set(result.model, {
        ...current,
        inputTokens: current.inputTokens + result.inputTokens,
        outputTokens: current.outputTokens + result.outputTokens,
        totalTokens: current.totalTokens + result.inputTokens + result.outputTokens,
        requestCount: current.requestCount + result.requestCount,
      });
      continue;
    }

    byModel.set(result.model, {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.inputTokens + result.outputTokens,
      requestCount: result.requestCount,
      costUsd: null,
    });
  }

  return [...byModel.values()].toSorted(
    (left, right) =>
      right.totalTokens - left.totalTokens ||
      right.requestCount - left.requestCount ||
      left.model.localeCompare(right.model),
  );
}

function aggregateOpenAiCosts(costResults: ReadonlyArray<OpenAiCostResult>): {
  readonly spendUsd: number | null;
  readonly currency: string | null;
} {
  if (costResults.length === 0) {
    return { spendUsd: null, currency: null };
  }

  const currencies = [...new Set(costResults.map((entry) => entry.currency).filter(Boolean))];
  const currency = currencies.length === 1 ? currencies[0] ?? null : null;
  if (currency !== "usd") {
    return { spendUsd: null, currency };
  }

  const spendUsd = costResults.reduce((sum, entry) => sum + entry.value, 0);
  return {
    spendUsd: Number(spendUsd.toFixed(6)),
    currency,
  };
}

function openAiProviderSyncBase(input: {
  readonly syncStatus: DashboardCloudProviderSync["syncStatus"];
  readonly enabled: boolean;
  readonly organizationName?: string | undefined;
  readonly organizationId?: string | undefined;
  readonly message?: string | null;
  readonly lastSyncAt?: string | null;
  readonly lastSyncError?: string | null;
}): DashboardCloudProviderSync {
  return {
    provider: "codex",
    enabled: input.enabled,
    syncStatus: input.syncStatus,
    coverage: "api-only",
    scopeType: "organization",
    scopeDisplayName: buildScopeDisplayName(input.organizationName, input.organizationId),
    message: input.message ?? null,
    lastSyncAt: input.lastSyncAt ?? null,
    lastSyncError: input.lastSyncError ?? null,
  };
}

export function emptyDashboardCloudSummary(): DashboardCloudSummary {
  return {
    source: "cloud_account",
    providers: [],
    accounts: [],
  };
}

export function buildOpenAiCloudSummaryNotConfigured(input: {
  readonly organizationName?: string | undefined;
  readonly organizationId?: string | undefined;
}): DashboardCloudSummary {
  return {
    source: "cloud_account",
    providers: [
      openAiProviderSyncBase({
        enabled: true,
        syncStatus: "not-configured",
        organizationName: input.organizationName,
        organizationId: input.organizationId,
        message: "Set XBECODE_OPENAI_ADMIN_KEY to enable OpenAI organization usage sync.",
      }),
    ],
    accounts: [],
  };
}

export function buildOpenAiCloudSummaryError(input: {
  readonly organizationName?: string | undefined;
  readonly organizationId?: string | undefined;
  readonly errorMessage: string;
  readonly lastSyncAt: string;
}): DashboardCloudSummary {
  return {
    source: "cloud_account",
    providers: [
      openAiProviderSyncBase({
        enabled: true,
        syncStatus: "error",
        organizationName: input.organizationName,
        organizationId: input.organizationId,
        message: "OpenAI account sync failed.",
        lastSyncAt: input.lastSyncAt,
        lastSyncError: input.errorMessage,
      }),
    ],
    accounts: [],
  };
}

export function buildOpenAiCloudSummarySuccess(input: {
  readonly period: DashboardUsagePeriod;
  readonly usagePayloads: ReadonlyArray<unknown>;
  readonly costPayloads: ReadonlyArray<unknown>;
  readonly organizationName?: string | undefined;
  readonly organizationId?: string | undefined;
  readonly lastSyncAt: string;
  readonly now?: Date | undefined;
}): DashboardCloudSummary {
  const usageResults = parseOpenAiUsageResults(input.usagePayloads);
  const models = aggregateOpenAiModelUsage(usageResults);
  const costs = aggregateOpenAiCosts(parseOpenAiCosts(input.costPayloads));
  const period = dashboardDateRange(input.period, input.now ?? new Date());
  const accountId = normalizedNonEmpty(input.organizationId, "openai-default-organization");
  const accountName = buildScopeDisplayName(input.organizationName, input.organizationId);
  const summary: DashboardCloudAccountSummary = {
    source: "cloud_account",
    provider: "codex",
    accountId,
    accountName,
    scopeType: "organization",
    scopeId: accountId,
    scopeDisplayName: accountName,
    coverage: "api-only",
    syncStatus: "ready",
    period: {
      from: period.dateFrom,
      to: period.dateTo,
    },
    lastSyncAt: input.lastSyncAt,
    lastSyncError: null,
    spendUsd: costs.spendUsd,
    currency: costs.currency,
    inputTokens: models.reduce((sum, model) => sum + model.inputTokens, 0),
    outputTokens: models.reduce((sum, model) => sum + model.outputTokens, 0),
    totalTokens: models.reduce((sum, model) => sum + model.totalTokens, 0),
    requestCount: models.reduce((sum, model) => sum + model.requestCount, 0),
    models,
  };

  return {
    source: "cloud_account",
    providers: [
      openAiProviderSyncBase({
        enabled: true,
        syncStatus: "ready",
        organizationName: input.organizationName,
        organizationId: input.organizationId,
        lastSyncAt: input.lastSyncAt,
      }),
    ],
    accounts: [summary],
  };
}
