import type { DashboardUsagePeriod, DashboardUsageSummary } from "@xbetools/contracts";
import { ProviderUsageCard } from "./ProviderUsageCard";
import { TokenBarChart } from "./TokenBarChart";
import { TopModelsTable } from "./TopModelsTable";
import { cn } from "~/lib/utils";

const PERIOD_OPTIONS: Array<{ value: DashboardUsagePeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

interface UsageSummarySectionProps {
  usage: DashboardUsageSummary | null;
  loading: boolean;
  error: string | null;
  period: DashboardUsagePeriod;
  onPeriodChange: (period: DashboardUsagePeriod) => void;
}

export function UsageSummarySection({
  usage,
  loading,
  error,
  period,
  onPeriodChange,
}: UsageSummarySectionProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">Usage</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Token usage and turn counts by provider and model.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-0.5">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPeriodChange(opt.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                period === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {loading && !usage ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Loading usage data...
        </div>
      ) : usage ? (
        <div className="space-y-6">
          {/* Provider cards */}
          {usage.providers.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {usage.providers.map((p) => (
                <ProviderUsageCard key={p.provider} data={p} />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No usage data for this period.
            </div>
          )}

          {/* Daily chart */}
          {usage.dailyTotals.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">Tokens by Day</h3>
              <TokenBarChart data={usage.dailyTotals} />
              <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-blue-300/60" /> Input
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-blue-500/80" /> Output
                </span>
              </div>
            </div>
          )}

          {/* Top models */}
          {usage.topModels.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">Top Models</h3>
              <TopModelsTable models={usage.topModels} />
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
