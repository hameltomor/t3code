import type { DashboardRateLimit, ProviderKind } from "@xbetools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface DashboardRateLimitStateShape {
  readonly getRateLimits: Effect.Effect<ReadonlyArray<DashboardRateLimit>>;
  readonly recordRateLimitUpdate: (
    provider: ProviderKind,
    raw: unknown,
    updatedAt: string,
  ) => Effect.Effect<void>;
}

export class DashboardRateLimitState extends ServiceMap.Service<
  DashboardRateLimitState,
  DashboardRateLimitStateShape
>()("xbe/dashboard/Services/DashboardRateLimitState") {}
