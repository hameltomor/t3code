import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ThreadExternalLink } from "@xbetools/contracts";

import {
  historyImportThreadLinksQueryOptions,
  historyImportValidateLinkMutationOptions,
} from "~/lib/historyImportReactQuery";

const REVALIDATION_THRESHOLD_MS = 3_600_000; // 1 hour

function shouldRevalidate(link: ThreadExternalLink): boolean {
  if (!link.lastValidatedAt) return true;
  return Date.now() - new Date(link.lastValidatedAt).getTime() > REVALIDATION_THRESHOLD_MS;
}

export function useThreadExternalLink(threadId: string, isImported: boolean) {
  const queryClient = useQueryClient();

  const linkQuery = useQuery(
    historyImportThreadLinksQueryOptions(isImported ? threadId : null),
  );

  const externalLink = linkQuery.data?.[0] ?? null;

  const validateMutation = useMutation(
    historyImportValidateLinkMutationOptions({ queryClient }),
  );

  useEffect(() => {
    if (
      externalLink !== null &&
      shouldRevalidate(externalLink) &&
      !validateMutation.isPending
    ) {
      validateMutation.mutate({ threadId });
    }
    // Only re-run when the link data or thread changes, not when mutation state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalLink, threadId]);

  return {
    externalLink,
    isLoading: linkQuery.isLoading,
    isValidating: validateMutation.isPending,
    validate: () => validateMutation.mutate({ threadId }),
  };
}
