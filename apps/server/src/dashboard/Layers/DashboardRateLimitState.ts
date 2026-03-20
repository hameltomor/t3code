import { Effect, Layer, Ref } from "effect";

import {
  dashboardProviders,
  emptyDashboardRateLimit,
  normalizeDashboardRateLimit,
} from "../dashboardDomain.ts";
import {
  DashboardRateLimitState,
  type DashboardRateLimitStateShape,
} from "../Services/DashboardRateLimitState.ts";

const makeDashboardRateLimitState = Effect.gen(function* () {
  const initialUpdatedAt = new Date(0).toISOString();
  const state = yield* Ref.make(
    new Map(
      dashboardProviders().map((provider) => [provider, emptyDashboardRateLimit(provider, initialUpdatedAt)]),
    ),
  );

  const getRateLimits: DashboardRateLimitStateShape["getRateLimits"] = Ref.get(state).pipe(
    Effect.map((snapshot) =>
      dashboardProviders().map((provider) => snapshot.get(provider) ?? emptyDashboardRateLimit(provider, initialUpdatedAt)),
    ),
  );

  const recordRateLimitUpdate: DashboardRateLimitStateShape["recordRateLimitUpdate"] = (
    provider,
    raw,
    updatedAt,
  ) =>
    Ref.update(state, (snapshot) => {
      const next = new Map(snapshot);
      next.set(
        provider,
        normalizeDashboardRateLimit({
          provider,
          raw,
          updatedAt,
        }),
      );
      return next;
    });

  return {
    getRateLimits,
    recordRateLimitUpdate,
  } satisfies DashboardRateLimitStateShape;
});

export const DashboardRateLimitStateLive = Layer.effect(
  DashboardRateLimitState,
  makeDashboardRateLimitState,
);
