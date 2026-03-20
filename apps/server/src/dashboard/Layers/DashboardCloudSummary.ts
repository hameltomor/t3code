import { Config, Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import type { DashboardUsagePeriod } from "@xbetools/contracts";

import {
  DashboardCloudSummaryService,
  type DashboardCloudSummaryShape,
} from "../Services/DashboardCloudSummary.ts";
import {
  buildOpenAiCloudSummaryError,
  buildOpenAiCloudSummaryNotConfigured,
  buildOpenAiCloudSummarySuccess,
  dashboardCloudDateRange,
  emptyDashboardCloudSummary,
} from "../dashboardCloudDomain.ts";

const OPENAI_API_BASE_URL = "https://api.openai.com";
const OPENAI_USAGE_PAGE_LIMIT = 180;
const OPENAI_MAX_PAGES = 25;

const DashboardCloudSyncEnvConfig = Config.all({
  enabled: Config.boolean("XBECODE_DASHBOARD_CLOUD_SYNC").pipe(Config.withDefault(false)),
  openAiEnabled: Config.boolean("XBECODE_DASHBOARD_OPENAI_ACCOUNT_SYNC").pipe(
    Config.withDefault(false),
  ),
  openAiAdminKeyPrimary: Config.string("XBECODE_OPENAI_ADMIN_KEY").pipe(Config.option),
  openAiAdminKeyFallback: Config.string("OPENAI_ADMIN_KEY").pipe(Config.option),
  openAiOrganizationId: Config.string("XBECODE_OPENAI_ORGANIZATION_ID").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  openAiOrganizationName: Config.string("XBECODE_OPENAI_ORGANIZATION_NAME").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

function buildOpenAiUsageUrl(input: {
  readonly period: DashboardUsagePeriod;
  readonly page: string | null;
  readonly now: Date;
}): URL {
  const { startTimeUnixSeconds, endTimeUnixSecondsExclusive } = dashboardCloudDateRange(
    input.period,
    input.now,
  );
  const url = new URL("/v1/organization/usage/completions", OPENAI_API_BASE_URL);
  url.searchParams.set("start_time", String(startTimeUnixSeconds));
  url.searchParams.set("end_time", String(endTimeUnixSecondsExclusive));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("group_by", "model");
  url.searchParams.set("limit", String(OPENAI_USAGE_PAGE_LIMIT));
  if (input.page) {
    url.searchParams.set("page", input.page);
  }
  return url;
}

function buildOpenAiCostsUrl(input: {
  readonly period: DashboardUsagePeriod;
  readonly page: string | null;
  readonly now: Date;
}): URL {
  const { startTimeUnixSeconds, endTimeUnixSecondsExclusive } = dashboardCloudDateRange(
    input.period,
    input.now,
  );
  const url = new URL("/v1/organization/costs", OPENAI_API_BASE_URL);
  url.searchParams.set("start_time", String(startTimeUnixSeconds));
  url.searchParams.set("end_time", String(endTimeUnixSecondsExclusive));
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("limit", String(OPENAI_USAGE_PAGE_LIMIT));
  if (input.page) {
    url.searchParams.set("page", input.page);
  }
  return url;
}

function nextPageToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).next_page;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function responseHasMore(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return (payload as Record<string, unknown>).has_more === true;
}

function openAiIdentity(config: {
  readonly openAiOrganizationId: string | undefined;
  readonly openAiOrganizationName: string | undefined;
}) {
  return {
    ...(config.openAiOrganizationName
      ? { organizationName: config.openAiOrganizationName }
      : {}),
    ...(config.openAiOrganizationId ? { organizationId: config.openAiOrganizationId } : {}),
  };
}

const makeDashboardCloudSummary = Effect.gen(function* () {
  const config = yield* DashboardCloudSyncEnvConfig.asEffect();
  const httpClient = yield* HttpClient.HttpClient;
  const adminKeyOption = Option.orElse(
    config.openAiAdminKeyPrimary,
    () => config.openAiAdminKeyFallback,
  );
  const identity = openAiIdentity(config);

  const fetchJson = (url: URL, adminKey: string) => {
    let request = HttpClientRequest.get(url);
    request = HttpClientRequest.acceptJson(request);
    request = HttpClientRequest.bearerToken(request, adminKey);
    if (config.openAiOrganizationId) {
      request = HttpClientRequest.setHeader(request, "OpenAI-Organization", config.openAiOrganizationId);
    }
    return httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
    );
  };

  const fetchAllPages = (buildUrl: (page: string | null) => URL, adminKey: string) =>
    Effect.gen(function* () {
      const pages: Array<unknown> = [];
      let nextPage: string | null = null;

      for (let pageIndex = 0; pageIndex < OPENAI_MAX_PAGES; pageIndex += 1) {
        const payload = yield* fetchJson(buildUrl(nextPage), adminKey);
        pages.push(payload);

        if (!responseHasMore(payload)) {
          break;
        }

        nextPage = nextPageToken(payload);
        if (!nextPage) {
          break;
        }
      }

      return pages as ReadonlyArray<unknown>;
    });

  const getSummary: DashboardCloudSummaryShape["getSummary"] = (period) =>
    Effect.gen(function* () {
      if (!config.enabled || !config.openAiEnabled) {
        return emptyDashboardCloudSummary();
      }

      if (Option.isNone(adminKeyOption)) {
        return buildOpenAiCloudSummaryNotConfigured(identity);
      }

      const adminKey = adminKeyOption.value;
      const now = new Date();
      const lastSyncAt = now.toISOString();
      const [usagePayloads, costPayloads] = yield* Effect.all([
        fetchAllPages((page) => buildOpenAiUsageUrl({ period, page, now }), adminKey),
        fetchAllPages((page) => buildOpenAiCostsUrl({ period, page, now }), adminKey),
      ]);

      return buildOpenAiCloudSummarySuccess({
        period,
        usagePayloads,
        costPayloads,
        lastSyncAt,
        now,
        ...identity,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          buildOpenAiCloudSummaryError({
            errorMessage: error instanceof Error ? error.message : String(error),
            lastSyncAt: new Date().toISOString(),
            ...identity,
          }),
        ),
      ),
    );

  return {
    getSummary,
  } satisfies DashboardCloudSummaryShape;
});

export const DashboardCloudSummaryLive = Layer.effect(
  DashboardCloudSummaryService,
  makeDashboardCloudSummary,
);
