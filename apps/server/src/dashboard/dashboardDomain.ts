import type {
  DashboardProviderStatus,
  DashboardRateLimit,
  DashboardUsagePeriod,
  NormalizedTokenUsage,
  OrchestrationThreadContextStatus,
  ProviderKind,
  ProviderSession,
  ServerProviderStatus,
} from "@xbetools/contracts";

const DASHBOARD_PROVIDERS: ReadonlyArray<ProviderKind> = ["codex", "claudeCode", "gemini"];

export function dashboardDateRange(
  period: DashboardUsagePeriod,
  now = new Date(),
): { dateFrom: string; dateTo: string } {
  const dateTo = now.toISOString().slice(0, 10);
  switch (period) {
    case "today":
      return { dateFrom: dateTo, dateTo };
    case "7d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { dateFrom: from.toISOString().slice(0, 10), dateTo };
    }
    case "30d": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { dateFrom: from.toISOString().slice(0, 10), dateTo };
    }
    case "all":
      return { dateFrom: "2000-01-01", dateTo };
  }
}

export function parseTokenUsageJson(
  tokenUsageJson: string | null | undefined,
): NormalizedTokenUsage | null {
  if (!tokenUsageJson) return null;
  try {
    return JSON.parse(tokenUsageJson) as NormalizedTokenUsage;
  } catch {
    return null;
  }
}

function positiveDiff(next: number | undefined, prev: number | undefined): number {
  return Math.max((next ?? 0) - (prev ?? 0), 0);
}

function isCodexCumulativeContextUsage(contextStatus: OrchestrationThreadContextStatus): boolean {
  return contextStatus.provider === "codex" && contextStatus.source === "provider-event";
}

function isIncrementalSdkUsage(contextStatus: OrchestrationThreadContextStatus): boolean {
  return contextStatus.source === "sdk-usage";
}

export function deriveDashboardUsageRecord(input: {
  readonly contextStatus: OrchestrationThreadContextStatus;
  readonly previousTokenUsage: NormalizedTokenUsage | null;
}): NormalizedTokenUsage | null {
  const usage = input.contextStatus.tokenUsage;
  if (!usage) return null;

  if (isCodexCumulativeContextUsage(input.contextStatus)) {
    const deltaTotal = positiveDiff(usage.totalTokens, input.previousTokenUsage?.totalTokens);
    if (deltaTotal <= 0) {
      return null;
    }
    return {
      totalTokens: deltaTotal,
      inputTokens: positiveDiff(usage.inputTokens, input.previousTokenUsage?.inputTokens),
      outputTokens: positiveDiff(usage.outputTokens, input.previousTokenUsage?.outputTokens),
      ...(usage.cachedInputTokens !== undefined || input.previousTokenUsage?.cachedInputTokens !== undefined
        ? {
            cachedInputTokens: positiveDiff(
              usage.cachedInputTokens,
              input.previousTokenUsage?.cachedInputTokens,
            ),
          }
        : {}),
      ...(usage.reasoningTokens !== undefined || input.previousTokenUsage?.reasoningTokens !== undefined
        ? {
            reasoningTokens: positiveDiff(
              usage.reasoningTokens,
              input.previousTokenUsage?.reasoningTokens,
            ),
          }
        : {}),
    };
  }

  if (isIncrementalSdkUsage(input.contextStatus)) {
    return usage;
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTimestampMs(value: number): number {
  return value >= 1_000_000_000_000 ? value : value * 1_000;
}

function extractRetryAfterMs(raw: unknown, nowMs: number): number | null {
  const record = asRecord(raw);
  if (!record) return null;

  const directMs =
    asNumber(record.retryAfterMs) ??
    asNumber(record.retry_after_ms) ??
    asNumber(record.retry_after_ms_value);
  if (directMs !== null) {
    return Math.max(directMs, 0);
  }

  const directSeconds =
    asNumber(record.retryAfter) ??
    asNumber(record.retry_after) ??
    asNumber(record.retry_after_seconds);
  if (directSeconds !== null) {
    return Math.max(directSeconds * 1_000, 0);
  }

  const resetsAt = asNumber(record.resetsAt) ?? asNumber(record.resetAt) ?? asNumber(record.reset_at);
  if (resetsAt !== null) {
    return Math.max(normalizeTimestampMs(resetsAt) - nowMs, 0);
  }

  for (const nested of Object.values(record)) {
    const nestedRetryAfterMs = extractRetryAfterMs(nested, nowMs);
    if (nestedRetryAfterMs !== null) {
      return nestedRetryAfterMs;
    }
  }

  return null;
}

function readEntryFromMetricRecord(record: Record<string, unknown>): { used: number; limit: number } | null {
  const limit = asNumber(record.limit) ?? asNumber(record.max) ?? asNumber(record.capacity);
  if (limit === null || limit <= 0) {
    return null;
  }

  const used =
    asNumber(record.used) ??
    asNumber(record.consumed) ??
    asNumber(record.current) ??
    asNumber(record.utilized);
  if (used !== null) {
    return { used: Math.max(used, 0), limit };
  }

  const remaining =
    asNumber(record.remaining) ??
    asNumber(record.available) ??
    asNumber(record.left);
  if (remaining !== null) {
    return { used: Math.max(limit - remaining, 0), limit };
  }

  return null;
}

function normalizeMetricName(value: string): string {
  return value.replaceAll(/[^a-z]/gi, "").toLowerCase();
}

function flattenRecords(
  raw: unknown,
  path: ReadonlyArray<string> = [],
): ReadonlyArray<{ path: ReadonlyArray<string>; record: Record<string, unknown> }> {
  const record = asRecord(raw);
  if (!record) return [];

  const current = [{ path, record }] as Array<{ path: ReadonlyArray<string>; record: Record<string, unknown> }>;
  for (const [key, value] of Object.entries(record)) {
    current.push(...flattenRecords(value, [...path, key]));
  }
  return current;
}

function extractMetricEntry(
  raw: unknown,
  aliases: ReadonlyArray<string>,
): { used: number; limit: number } | null {
  const normalizedAliases = new Set(aliases.map(normalizeMetricName));
  const records = flattenRecords(raw);

  for (const entry of records) {
    const leaf = entry.path.at(-1);
    if (!leaf) continue;
    if (!normalizedAliases.has(normalizeMetricName(leaf))) continue;
    const metric = readEntryFromMetricRecord(entry.record);
    if (metric) return metric;
  }

  const root = asRecord(raw);
  if (!root) return null;

  for (const alias of aliases) {
    const camelLimit = `${alias}Limit`;
    const snakeLimit = `${alias}_limit`;
    const camelRemaining = `${alias}Remaining`;
    const snakeRemaining = `${alias}_remaining`;
    const camelUsed = `${alias}Used`;
    const snakeUsed = `${alias}_used`;

    const limit =
      asNumber(root[camelLimit]) ??
      asNumber(root[snakeLimit]) ??
      asNumber(root[camelLimit.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)]) ??
      asNumber(root[snakeLimit.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)]);
    if (limit === null || limit <= 0) continue;

    const used = asNumber(root[camelUsed]) ?? asNumber(root[snakeUsed]);
    if (used !== null) {
      return { used: Math.max(used, 0), limit };
    }

    const remaining = asNumber(root[camelRemaining]) ?? asNumber(root[snakeRemaining]);
    if (remaining !== null) {
      return { used: Math.max(limit - remaining, 0), limit };
    }
  }

  return null;
}

export function normalizeDashboardRateLimit(input: {
  readonly provider: ProviderKind;
  readonly raw: unknown;
  readonly updatedAt: string;
  readonly now?: Date;
}): DashboardRateLimit {
  const nowMs = (input.now ?? new Date()).getTime();
  const rawRecord = asRecord(input.raw);

  if (
    input.provider === "claudeCode" &&
    rawRecord?.type === "rate_limit_event" &&
    rawRecord.rate_limit_info !== undefined
  ) {
    return {
      provider: input.provider,
      requestsPerMinute: null,
      tokensPerMinute: null,
      tokensPerDay: null,
      retryAfterMs: extractRetryAfterMs(rawRecord.rate_limit_info, nowMs),
      updatedAt: input.updatedAt,
    };
  }

  return {
    provider: input.provider,
    requestsPerMinute: extractMetricEntry(input.raw, [
      "rpm",
      "requestsPerMinute",
      "requests_per_minute",
      "requests",
    ]),
    tokensPerMinute: extractMetricEntry(input.raw, [
      "tpm",
      "tokensPerMinute",
      "tokens_per_minute",
      "tokens",
    ]),
    tokensPerDay: extractMetricEntry(input.raw, [
      "tpd",
      "tokensPerDay",
      "tokens_per_day",
      "dailyTokens",
      "daily_tokens",
    ]),
    retryAfterMs: extractRetryAfterMs(input.raw, nowMs),
    updatedAt: input.updatedAt,
  };
}

export function emptyDashboardRateLimit(
  provider: ProviderKind,
  updatedAt: string,
): DashboardRateLimit {
  return {
    provider,
    requestsPerMinute: null,
    tokensPerMinute: null,
    tokensPerDay: null,
    retryAfterMs: null,
    updatedAt,
  };
}

export function buildDashboardProviderStatuses(input: {
  readonly healthStatuses: ReadonlyArray<ServerProviderStatus>;
  readonly sessions: ReadonlyArray<ProviderSession>;
}): ReadonlyArray<DashboardProviderStatus> {
  const healthByProvider = new Map(input.healthStatuses.map((status) => [status.provider, status]));
  const sessionsByProvider = new Map<ProviderKind, ReadonlyArray<ProviderSession>>(
    DASHBOARD_PROVIDERS.map((provider) => [
      provider,
      input.sessions.filter((session) => session.provider === provider),
    ]),
  );

  return DASHBOARD_PROVIDERS.map((provider) => {
    const health = healthByProvider.get(provider);
    const sessions = sessionsByProvider.get(provider) ?? [];
    const sessionError = sessions.find((session) => session.lastError)?.lastError ?? null;

    if (sessions.length > 0) {
      return {
        provider,
        status: "connected",
        authStatus: health?.authStatus ?? "unknown",
        activeSessionCount: sessions.length,
        lastError: sessionError ?? health?.message ?? null,
      };
    }

    if (!health) {
      return {
        provider,
        status: "disconnected",
        authStatus: "unknown",
        activeSessionCount: 0,
        lastError: sessionError,
      };
    }

    const status: DashboardProviderStatus["status"] =
      health.authStatus === "unauthenticated"
        ? "unconfigured"
        : health.status === "ready"
          ? "disconnected"
          : health.status === "warning"
            ? "warning"
            : "error";

    return {
      provider,
      status,
      authStatus: health.authStatus,
      activeSessionCount: 0,
      lastError: sessionError ?? health.message ?? null,
    };
  });
}

export function dashboardProviders(): ReadonlyArray<ProviderKind> {
  return DASHBOARD_PROVIDERS;
}
