import { useMemo, useState } from "react";
import { LoaderIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { HistoryImportProvider, HistoryImportConversationSummary } from "@xbetools/contracts";
import { historyImportListQueryOptions } from "~/lib/historyImportReactQuery";
import { Badge } from "~/components/ui/badge";
import type { WizardAction } from "../useImportWizardReducer";
import { Button } from "~/components/ui/button";

interface SessionListStepProps {
  workspaceRoot: string | null;
  providerFilter: HistoryImportProvider | null;
  dispatch: React.Dispatch<WizardAction>;
  providerThreadIds: Set<string>;
}

const LINK_MODE_LABELS: Record<string, string> = {
  "native-resume": "Resumable",
  "transcript-replay": "Replay",
  "snapshot-only": "Snapshot",
};

function isAlreadyImported(
  session: HistoryImportConversationSummary,
  providerThreadIds: Set<string>,
): boolean {
  const prefixedConversation = session.providerConversationId
    ? `${session.providerName}:${session.providerConversationId}`
    : null;
  const prefixedSession = session.providerSessionId
    ? `${session.providerName}:${session.providerSessionId}`
    : null;
  return (
    (prefixedConversation != null && providerThreadIds.has(prefixedConversation)) ||
    (prefixedSession != null && providerThreadIds.has(prefixedSession))
  );
}

export function SessionListStep({
  workspaceRoot,
  providerFilter,
  dispatch,
  providerThreadIds,
}: SessionListStepProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, isFetching, error, refetch } = useQuery(
    historyImportListQueryOptions(workspaceRoot, providerFilter),
  );

  const filteredSessions = useMemo(() => {
    if (!data) return [];
    if (!searchQuery.trim()) return data;
    const query = searchQuery.toLowerCase();
    return data.filter(
      (session) =>
        session.title.toLowerCase().includes(query) ||
        session.cwd.toLowerCase().includes(query),
    );
  }, [data, searchQuery]);

  const handleSessionClick = (session: HistoryImportConversationSummary) => {
    dispatch({ type: "SELECT_SESSION", session });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-md border bg-transparent pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={isFetching}
          onClick={() => void refetch()}
          aria-label="Refresh sessions"
        >
          <RefreshCwIcon className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
          Scanning...
        </div>
      )}

      {error && (
        <div className="py-8 text-center text-sm text-destructive">
          {error.message}
        </div>
      )}

      {!isLoading && !error && filteredSessions.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No importable conversations found
        </div>
      )}

      {!isLoading && filteredSessions.length > 0 && (
        <div className="max-h-80 overflow-y-auto">
          {filteredSessions.map((session) => {
            const imported = isAlreadyImported(session, providerThreadIds);
            return (
              <button
                key={session.catalogId}
                type="button"
                className="flex w-full cursor-pointer flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent"
                onClick={() => handleSessionClick(session)}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" size="sm">
                    {session.providerName}
                  </Badge>
                  <span className="flex-1 truncate text-sm font-medium">
                    {session.title}
                  </span>
                  {imported && (
                    <Badge variant="success" size="sm">
                      Imported
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="truncate">{session.cwd}</span>
                  <span className="shrink-0">
                    {new Date(session.createdAt).toLocaleDateString()}
                  </span>
                  <Badge variant="secondary" size="sm">
                    {session.messageCount} msgs
                  </Badge>
                  <Badge variant="info" size="sm">
                    {LINK_MODE_LABELS[session.linkMode] ?? session.linkMode}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
