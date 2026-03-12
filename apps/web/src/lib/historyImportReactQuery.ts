import type { HistoryImportProvider, HistoryImportExecuteInput, ThreadId } from "@xbetools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

export const historyImportQueryKeys = {
  all: ["historyImport"] as const,
  list: (workspaceRoot: string, providerFilter: string | null) =>
    ["historyImport", "list", workspaceRoot, providerFilter] as const,
  preview: (catalogId: string | null) => ["historyImport", "preview", catalogId] as const,
  threadLinks: (threadId: string) => ["historyImport", "threadLinks", threadId] as const,
};

export function historyImportListQueryOptions(
  workspaceRoot: string | null,
  providerFilter: string | null,
) {
  return queryOptions({
    queryKey: historyImportQueryKeys.list(workspaceRoot ?? "", providerFilter),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.historyImport.list({
        workspaceRoot: workspaceRoot!,
        ...(providerFilter != null
          ? { providerFilter: providerFilter as HistoryImportProvider }
          : {}),
      });
    },
    enabled: workspaceRoot !== null,
    staleTime: 30_000,
  });
}

export function historyImportPreviewQueryOptions(catalogId: string | null) {
  return queryOptions({
    queryKey: historyImportQueryKeys.preview(catalogId),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.historyImport.preview({ catalogId: catalogId! });
    },
    enabled: catalogId !== null,
    staleTime: 60_000,
  });
}

export function historyImportExecuteMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["historyImport", "mutation", "execute"] as const,
    mutationFn: async (params: HistoryImportExecuteInput) => {
      const api = ensureNativeApi();
      return api.historyImport.execute(params);
    },
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: historyImportQueryKeys.all });
    },
  });
}

export function historyImportThreadLinksQueryOptions(threadId: string | null) {
  return queryOptions({
    queryKey: historyImportQueryKeys.threadLinks(threadId ?? ""),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.historyImport.listThreadLinks({ threadId: threadId! as ThreadId });
    },
    enabled: threadId !== null,
    staleTime: 60_000,
  });
}

export function historyImportValidateLinkMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationKey: ["historyImport", "mutation", "validateLink"] as const,
    mutationFn: async (params: { threadId: string }) => {
      const api = ensureNativeApi();
      return api.historyImport.validateLink({ threadId: params.threadId as ThreadId });
    },
    onSuccess: async (_data, variables) => {
      await input.queryClient.invalidateQueries({
        queryKey: historyImportQueryKeys.threadLinks(variables.threadId),
      });
    },
  });
}
