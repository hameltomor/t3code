import type { DashboardProviderUsage } from "@xbetools/contracts";

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeCode: "Claude Code",
  gemini: "Gemini",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ProviderUsageCard({ data }: { data: DashboardProviderUsage }) {
  const label = PROVIDER_LABELS[data.provider] ?? data.provider;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {formatTokens(data.totalTokens)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">tokens</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{formatTokens(data.inputTokens)} in</span>
        <span>{formatTokens(data.outputTokens)} out</span>
        <span className="ml-auto">{data.turnCount} turns</span>
      </div>
    </div>
  );
}
