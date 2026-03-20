import type { DashboardCloudProviderSync, DashboardCloudSummary } from "@xbetools/contracts";

import { cn } from "~/lib/utils";

const PROVIDER_LABELS: Record<string, string> = {
  codex: "OpenAI / Codex",
  claudeCode: "Anthropic / Claude Code",
  gemini: "Google / Gemini",
};

const STATUS_STYLES: Record<
  DashboardCloudProviderSync["syncStatus"],
  { dot: string; badge: string; label: string }
> = {
  disabled: {
    dot: "bg-muted-foreground/30",
    badge: "border-border text-muted-foreground",
    label: "Disabled",
  },
  "not-configured": {
    dot: "bg-yellow-500",
    badge: "border-yellow-500/20 text-yellow-400",
    label: "Needs setup",
  },
  ready: {
    dot: "bg-emerald-500",
    badge: "border-emerald-500/20 text-emerald-400",
    label: "Synced",
  },
  error: {
    dot: "bg-red-500",
    badge: "border-red-500/20 text-red-400",
    label: "Sync failed",
  },
};

function formatCompact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatUsd(value: number | null): string {
  if (value === null) return "Unavailable";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatRelativeSync(value: string | null): string {
  if (!value) return "Never";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "Just now";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function ProviderSyncNotice({ sync }: { sync: DashboardCloudProviderSync }) {
  const style = STATUS_STYLES[sync.syncStatus];
  const label = PROVIDER_LABELS[sync.provider] ?? sync.provider;

  return (
    <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{sync.scopeDisplayName}</div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            style.badge,
          )}
        >
          <span className={cn("size-1.5 rounded-full", style.dot)} />
          {style.label}
        </span>
      </div>

      <div className="text-xs text-muted-foreground leading-relaxed">
        {sync.message ?? "Provider cloud sync is ready."}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
        <span>Coverage: {sync.coverage}</span>
        <span>Last sync: {formatRelativeSync(sync.lastSyncAt)}</span>
      </div>

      {sync.lastSyncError && (
        <div className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-snug text-destructive">
          {sync.lastSyncError}
        </div>
      )}
    </div>
  );
}

export function CloudAccountsSection({ cloud }: { cloud: DashboardCloudSummary | null }) {
  if (!cloud || (cloud.providers.length === 0 && cloud.accounts.length === 0)) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Cloud Accounts</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Provider-reported account usage beyond local XBE runtime sessions.
        </p>
      </div>

      {cloud.accounts.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {cloud.accounts.map((account) => {
            const providerLabel = PROVIDER_LABELS[account.provider] ?? account.provider;
            const maxTokens = Math.max(...account.models.map((model) => model.totalTokens), 1);

            return (
              <article key={account.accountId} className="rounded-xl border border-border bg-background/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{account.accountName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {providerLabel} · {account.coverage} · {account.scopeDisplayName}
                    </div>
                  </div>
                  <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                    Synced
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-lg border border-border bg-card/60 p-3">
                    <div className="text-muted-foreground">Spend</div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {formatUsd(account.spendUsd)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card/60 p-3">
                    <div className="text-muted-foreground">Tokens</div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {formatCompact(account.totalTokens)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card/60 p-3">
                    <div className="text-muted-foreground">Requests</div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {formatCompact(account.requestCount)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2.5">
                  {account.models.slice(0, 6).map((model) => {
                    const width = Math.max((model.totalTokens / maxTokens) * 100, 6);
                    return (
                      <div key={model.model} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="truncate text-foreground">{model.model}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {formatCompact(model.totalTokens)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground/80">
                  <span>
                    Period: {account.period.from} to {account.period.to}
                  </span>
                  <span>Last sync: {formatRelativeSync(account.lastSyncAt)}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {cloud.providers.map((sync) => (
            <ProviderSyncNotice key={`${sync.provider}-${sync.scopeDisplayName}`} sync={sync} />
          ))}
        </div>
      )}
    </section>
  );
}
