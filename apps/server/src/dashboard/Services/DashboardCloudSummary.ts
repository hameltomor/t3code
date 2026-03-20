import type { DashboardCloudSummary, DashboardUsagePeriod } from "@xbetools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface DashboardCloudSummaryShape {
  readonly getSummary: (
    period: DashboardUsagePeriod,
  ) => Effect.Effect<DashboardCloudSummary>;
}

export class DashboardCloudSummaryService extends ServiceMap.Service<
  DashboardCloudSummaryService,
  DashboardCloudSummaryShape
>()("xbe/dashboard/Services/DashboardCloudSummary/DashboardCloudSummaryService") {}
