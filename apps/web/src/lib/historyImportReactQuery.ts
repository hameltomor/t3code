import type { HistoryImportProvider, HistoryImportExecuteInput } from "@xbetools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";

export const historyImportQueryKeys = {
  all: ["historyImport"] as const,
  list: (workspaceRoot: string, providerFilter: string | null) =>
    ["historyImport", "list", workspaceRoot, providerFilter] as const,
  preview: (catalogId: string | null) => ["historyImport", "preview", catalogId] as const,
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
