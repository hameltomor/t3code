import type { DashboardProviderStatus } from "@xbetools/contracts";
import { cn } from "~/lib/utils";

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeCode: "Claude Code",
  gemini: "Gemini",
};

const STATUS_CONFIG: Record<
  DashboardProviderStatus["status"],
  { dot: string; label: string; bg: string }
> = {
  connected: { dot: "bg-emerald-500", label: "Connected", bg: "border-emerald-500/20" },
  disconnected: { dot: "bg-muted-foreground/40", label: "Disconnected", bg: "border-border" },
  error: { dot: "bg-yellow-500", label: "Error", bg: "border-yellow-500/20" },
  unconfigured: { dot: "bg-muted-foreground/20", label: "Not configured", bg: "border-border" },
};

function ProviderStatusCard({ data }: { data: DashboardProviderStatus }) {
  const label = PROVIDER_LABELS[data.provider] ?? data.provider;
  const config = STATUS_CONFIG[data.status];

  return (
    <div className={cn("rounded-xl border bg-card p-4 space-y-3", config.bg)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", config.dot)} />
          <span className="text-[11px] text-muted-foreground">{config.label}</span>
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>API Key</span>
          <span className={data.hasApiKey ? "text-emerald-500" : "text-muted-foreground/50"}>
            {data.hasApiKey ? "Configured" : "Missing"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Active sessions</span>
          <span className="tabular-nums">{data.activeSessionCount}</span>
        </div>
      </div>

      {data.lastError && (
        <div className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive leading-snug">
          {data.lastError}
        </div>
      )}
    </div>
  );
}

export function ProviderStatusSection({
  providerStatus,
}: {
  providerStatus: readonly DashboardProviderStatus[];
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Provider Status</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Connection status and configuration for each AI provider.
        </p>
      </div>

      {providerStatus.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providerStatus.map((ps) => (
            <ProviderStatusCard key={ps.provider} data={ps} />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Provider status will appear here.
        </div>
      )}
    </section>
  );
}
