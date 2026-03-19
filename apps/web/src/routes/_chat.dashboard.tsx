import { createFileRoute } from "@tanstack/react-router";

import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import { SidebarInset, SidebarTrigger, useSidebar } from "~/components/ui/sidebar";

function DashboardRouteView() {
  const { open: sidebarOpen } = useSidebar();

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

            {/* Phase 4: UsageSummarySection */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Usage</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Token usage and turn counts by provider and model.
                </p>
              </div>
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Usage data will appear here after AI interactions.
              </div>
            </section>

            {/* Phase 5: RateLimitsSection */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Rate Limits</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Current rate limit status for each provider.
                </p>
              </div>
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Rate limit data will appear during active sessions.
              </div>
            </section>

            {/* Phase 6: ProviderStatusSection */}
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Provider Status</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Connection status and configuration for each AI provider.
                </p>
              </div>
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Provider status will appear here.
              </div>
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/dashboard")({
  component: DashboardRouteView,
});
