import Fuse, { type IFuseOptions } from "fuse.js";
import { useMemo, useState } from "react";

import type { Thread, Project } from "../types";
import type { ProjectId } from "@xbetools/contracts";

export interface ThreadSearchEntry {
  thread: Thread;
  /** First user message text, used for deeper content matching */
  firstUserMessage: string;
  /** Concatenation of all user message texts for full content search */
  allUserMessages: string;
}

const FUSE_OPTIONS: IFuseOptions<ThreadSearchEntry> = {
  keys: [
    { name: "thread.title", weight: 1.0 },
    { name: "thread.branch", weight: 0.5 },
    { name: "firstUserMessage", weight: 0.7 },
    { name: "allUserMessages", weight: 0.3 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

function buildSearchEntries(threads: readonly Thread[]): ThreadSearchEntry[] {
  return threads.map((thread) => {
    const userMessages = thread.messages.filter((m) => m.role === "user");
    return {
      thread,
      firstUserMessage: userMessages[0]?.text ?? "",
      allUserMessages: userMessages.map((m) => m.text).join(" "),
    };
  });
}

export interface ThreadSearchResult {
  query: string;
  setQuery: (query: string) => void;
  /** When searching: filtered threads grouped by project. When empty: null (use default view). */
  filteredThreadIdSet: ReadonlySet<string> | null;
  /** Total number of matching threads across all projects */
  matchCount: number;
  isSearching: boolean;
}

export function useThreadSearch(
  threads: readonly Thread[],
  _projects: readonly Project[],
): ThreadSearchResult {
  const [query, setQuery] = useState("");

  const searchEntries = useMemo(() => buildSearchEntries(threads), [threads]);

  const fuseIndex = useMemo(() => new Fuse(searchEntries, FUSE_OPTIONS), [searchEntries]);

  const filteredThreadIdSet = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return null;

    const results = fuseIndex.search(trimmed, { limit: 50 });
    return new Set(results.map((r) => r.item.thread.id));
  }, [query, fuseIndex]);

  return {
    query,
    setQuery,
    filteredThreadIdSet,
    matchCount: filteredThreadIdSet?.size ?? 0,
    isSearching: query.trim().length >= 2,
  };
}

/** Filter and sort threads for a project, respecting search results */
export function getProjectThreadsForSearch(
  threads: readonly Thread[],
  projectId: ProjectId,
  filteredThreadIdSet: ReadonlySet<string> | null,
): Thread[] {
  let projectThreads = threads.filter((t) => t.projectId === projectId);

  if (filteredThreadIdSet !== null) {
    projectThreads = projectThreads.filter((t) => filteredThreadIdSet.has(t.id));
  }

  return projectThreads.toSorted((a, b) => {
    const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (byDate !== 0) return byDate;
    return b.id.localeCompare(a.id);
  });
}
