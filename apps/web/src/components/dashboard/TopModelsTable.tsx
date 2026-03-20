import type { DashboardTopModel } from "@xbetools/contracts";

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeCode: "Claude",
  gemini: "Gemini",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TopModelsTable({ models }: { models: readonly DashboardTopModel[] }) {
  if (models.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
        No model usage data yet.
      </div>
    );
  }

  const maxTokens = Math.max(...models.map((m) => m.totalTokens), 1);

  return (
    <div className="space-y-2">
      {models.map((model, i) => {
        const pct = (model.totalTokens / maxTokens) * 100;
        return (
          <div key={`${model.provider}:${model.model}`} className="flex items-center gap-3">
            <span className="w-5 text-right text-xs font-medium text-muted-foreground/60">
              {i + 1}.
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-foreground truncate">
                  {model.model}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {PROVIDER_LABELS[model.provider] ?? model.provider}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-blue-500/70"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="text-right text-xs tabular-nums text-muted-foreground whitespace-nowrap">
              {formatTokens(model.totalTokens)} &middot; {model.turnCount} turns
            </div>
          </div>
        );
      })}
    </div>
  );
}
