import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { DashboardUsagePeriod } from "@xbetools/contracts";

import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import { SidebarInset, SidebarTrigger, useSidebar } from "~/components/ui/sidebar";
import { UsageSummarySection } from "~/components/dashboard/UsageSummarySection";
import { RateLimitsSection } from "~/components/dashboard/RateLimitsSection";
import { ProviderStatusSection } from "~/components/dashboard/ProviderStatusSection";
import { useDashboardData } from "~/hooks/useDashboardData";

function DashboardRouteView() {
  const { open: sidebarOpen } = useSidebar();
  const [period, setPeriod] = useState<DashboardUsagePeriod>("7d");
  const { usage, rateLimits, providerStatus, loading, error } = useDashboardData(period);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div
            className={cn(
              "drag-region flex h-[52px] shrink-0 items-center border-b border-border pr-5",
              sidebarOpen ? "pl-5" : "pl-[82px]",
            )}
          >
            <SidebarTrigger className="mr-3 size-7 shrink-0" />
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Dashboard
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Usage, rate limits, and provider status across all AI models.
              </p>
            </header>

            <UsageSummarySection
              usage={usage}
              loading={loading}
              error={error}
              period={period}
              onPeriodChange={setPeriod}
            />

            <RateLimitsSection rateLimits={rateLimits} />

            <ProviderStatusSection providerStatus={providerStatus} />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/dashboard")({
  component: DashboardRouteView,
});
