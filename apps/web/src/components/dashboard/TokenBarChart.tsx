import type { DashboardDailyUsage } from "@xbetools/contracts";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TokenBarChart({ data }: { data: readonly DashboardDailyUsage[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No usage data for this period.
      </div>
    );
  }

  const maxTotal = Math.max(...data.map((d) => d.totalTokens), 1);

  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((day) => {
        const inputPct = (day.inputTokens / maxTotal) * 100;
        const outputPct = (day.outputTokens / maxTotal) * 100;

        return (
          <div
            key={day.date}
            className="group relative flex flex-1 flex-col items-center"
            style={{ height: "100%" }}
          >
            {/* Tooltip */}
            <div className="pointer-events-none absolute -top-16 z-10 hidden rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm group-hover:block">
              <div className="font-medium">{formatDate(day.date)}</div>
              <div>{formatTokens(day.inputTokens)} in / {formatTokens(day.outputTokens)} out</div>
            </div>

            {/* Bar container */}
            <div className="flex w-full flex-1 flex-col justify-end gap-px">
              <div
                className="w-full rounded-t-sm bg-blue-500/80"
                style={{ height: `${outputPct}%`, minHeight: day.outputTokens > 0 ? 2 : 0 }}
              />
              <div
                className="w-full rounded-b-sm bg-blue-300/60"
                style={{ height: `${inputPct}%`, minHeight: day.inputTokens > 0 ? 2 : 0 }}
              />
            </div>

            {/* Date label */}
            {data.length <= 14 && (
              <div className="mt-1 text-[9px] text-muted-foreground/60 truncate max-w-full">
                {formatDate(day.date)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
