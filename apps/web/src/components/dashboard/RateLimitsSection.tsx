import type { DashboardRateLimit, RateLimitEntry } from "@xbetools/contracts";
import { cn } from "~/lib/utils";

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeCode: "Claude Code",
  gemini: "Gemini",
};

function pct(entry: RateLimitEntry): number {
  if (entry.limit <= 0) return 0;
  return Math.min((entry.used / entry.limit) * 100, 100);
}

function statusColor(percent: number): string {
  if (percent > 85) return "bg-red-500";
  if (percent > 60) return "bg-yellow-500";
  return "bg-emerald-500";
}

function statusDot(percent: number): string {
  if (percent > 85) return "text-red-500";
  if (percent > 60) return "text-yellow-500";
  return "text-emerald-500";
}

function statusLabel(percent: number): string {
  if (percent > 85) return "Critical";
  if (percent > 60) return "Warning";
  return "OK";
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function RateLimitBar({
  label,
  entry,
  unit,
}: {
  label: string;
  entry: RateLimitEntry;
  unit: string;
}) {
  const p = pct(entry);

  return (
    <div className="group relative flex items-center gap-3">
      <span className="w-8 text-right text-[10px] font-medium text-muted-foreground/70">
        {label}
      </span>
      <div className="relative flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", statusColor(p))}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="w-24 text-right text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(entry.used)}/{formatNumber(entry.limit)} {unit}
      </span>
      <span className={cn("text-[10px] font-medium", statusDot(p))}>
        {statusLabel(p)}
      </span>

      {/* Tooltip on hover */}
      <div className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-sm whitespace-nowrap group-hover:block">
        {entry.used.toLocaleString()} / {entry.limit.toLocaleString()} {unit}
        {" "}({p.toFixed(1)}%)
      </div>
    </div>
  );
}

function ProviderRateLimitCard({ data }: { data: DashboardRateLimit }) {
  const label = PROVIDER_LABELS[data.provider] ?? data.provider;
  const hasData = data.requestsPerMinute || data.tokensPerMinute || data.tokensPerDay;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {data.updatedAt && hasData && (
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(data.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {hasData ? (
        <div className="space-y-1.5">
          {data.requestsPerMinute && (
            <RateLimitBar label="RPM" entry={data.requestsPerMinute} unit="req/min" />
          )}
          {data.tokensPerMinute && (
            <RateLimitBar label="TPM" entry={data.tokensPerMinute} unit="tok/min" />
          )}
          {data.tokensPerDay && (
            <RateLimitBar label="TPD" entry={data.tokensPerDay} unit="tok/day" />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center py-3 text-xs text-muted-foreground/60">
          No rate limit data available
        </div>
      )}
    </div>
  );
}

export function RateLimitsSection({
  rateLimits,
}: {
  rateLimits: readonly DashboardRateLimit[];
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-foreground">Rate Limits</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Current rate limit status for each provider.
        </p>
      </div>

      {rateLimits.length > 0 ? (
        <div className="space-y-5 divide-y divide-border">
          {rateLimits.map((rl) => (
            <div key={rl.provider} className="first:pt-0 pt-5">
              <ProviderRateLimitCard data={rl} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          Rate limit data will appear during active sessions.
        </div>
      )}
    </section>
  );
}
