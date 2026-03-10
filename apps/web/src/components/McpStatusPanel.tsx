import { useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  RefreshCwIcon,
  PlugIcon,
  PowerOffIcon,
} from "lucide-react";

import type { McpServerStatusItem, McpServerConnectionStatus, ThreadId } from "@xbetools/contracts";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";

// ── Query keys ───────────────────────────────────────────────────────

const mcpQueryKeys = {
  status: (threadId: string | null) => ["mcp", "status", threadId] as const,
};

// ── Helpers ──────────────────────────────────────────────────────────

function statusVariant(
  status: McpServerConnectionStatus,
): "success" | "error" | "warning" | "info" | "outline" {
  switch (status) {
    case "connected":
      return "success";
    case "failed":
      return "error";
    case "needs-auth":
      return "warning";
    case "pending":
      return "info";
    case "disabled":
      return "outline";
  }
}

// ── Server Row ───────────────────────────────────────────────────────

function McpServerRow({
  server,
  threadId,
}: {
  server: McpServerStatusItem;
  threadId: ThreadId;
}) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: mcpQueryKeys.status(threadId) }),
    [queryClient, threadId],
  );

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const api = ensureNativeApi();
      const newEnabled = server.status === "disabled";
      await api.mcp.toggleServer({
        threadId,
        serverName: server.name,
        enabled: newEnabled,
      });
    },
    onSuccess: invalidate,
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const api = ensureNativeApi();
      await api.mcp.reconnectServer({ threadId, serverName: server.name });
    },
    onSuccess: invalidate,
  });

  const toolCount = server.tools?.length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {toolCount > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ChevronRightIcon
                className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
              />
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="truncate text-sm font-medium text-foreground">{server.name}</span>
          {server.scope ? (
            <Badge variant="outline" size="sm">
              {server.scope}
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant={statusVariant(server.status)} size="sm">
            {server.status}
          </Badge>
          {toolCount > 0 ? (
            <span className="text-xs text-muted-foreground">{toolCount} tools</span>
          ) : null}
          {server.status === "failed" ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => reconnectMutation.mutate()}
              disabled={reconnectMutation.isPending}
              title="Reconnect"
            >
              <RefreshCwIcon className="size-3" />
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            title={server.status === "disabled" ? "Enable" : "Disable"}
          >
            {server.status === "disabled" ? (
              <PlugIcon className="size-3" />
            ) : (
              <PowerOffIcon className="size-3" />
            )}
          </Button>
        </div>
      </div>
      {server.error ? (
        <p className="mt-1 pl-5.5 text-xs text-destructive">{server.error}</p>
      ) : null}
      {expanded && server.tools && server.tools.length > 0 ? (
        <div className="mt-2 space-y-1 border-t border-border pl-5.5 pt-2">
          {server.tools.map((tool) => (
            <div key={tool.name} className="flex items-start gap-2 text-xs">
              <code className="shrink-0 text-foreground">{tool.name}</code>
              {tool.description ? (
                <span className="line-clamp-1 text-muted-foreground">{tool.description}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────

export function McpStatusPanel({
  threadId,
  sessionStatus,
}: {
  threadId: ThreadId;
  sessionStatus: string | null;
}) {
  const [open, setOpen] = useState(false);

  const isSessionActive =
    sessionStatus === "ready" || sessionStatus === "running" || sessionStatus === "connecting";

  const mcpQuery = useQuery({
    queryKey: mcpQueryKeys.status(threadId),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.mcp.getStatus({ threadId });
    },
    enabled: open && isSessionActive,
    refetchInterval: open && isSessionActive ? 10_000 : false,
    staleTime: 5_000,
    retry: 1,
  });

  const servers = mcpQuery.data?.servers ?? [];
  const connectedCount = servers.filter((s) => s.status === "connected").length;
  const totalCount = servers.length;
  const hasError = servers.some((s) => s.status === "failed");

  return (
    <div className="border-b border-border px-3 py-2 sm:px-5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent">
          <ChevronRightIcon
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span className="text-xs font-medium text-foreground">MCP Servers</span>
          {!open && totalCount > 0 ? (
            <Badge variant={hasError ? "warning" : "success"} size="sm">
              {connectedCount}/{totalCount}
            </Badge>
          ) : null}
          {!open && !isSessionActive ? (
            <span className="text-xs text-muted-foreground">session inactive</span>
          ) : null}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2">
            {!isSessionActive ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                No active session. MCP status is available when a Claude Code session is running.
              </div>
            ) : mcpQuery.isLoading ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                Loading MCP server status...
              </div>
            ) : servers.length === 0 ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                No MCP servers configured.
              </div>
            ) : (
              servers.map((server) => (
                <McpServerRow key={server.name} server={server} threadId={threadId} />
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
