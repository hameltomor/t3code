import type { Thread, WorkspaceWorktreeEntry } from "./types";

function normalizeWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

export function getOrphanedWorktreePathForThread(
  threads: readonly Thread[],
  threadId: Thread["id"],
): string | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) {
    return null;
  }

  const targetWorktreePath = normalizeWorktreePath(targetThread.worktreePath);
  if (!targetWorktreePath) {
    return null;
  }

  const isShared = threads.some((thread) => {
    if (thread.id === threadId) {
      return false;
    }
    return normalizeWorktreePath(thread.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : targetWorktreePath;
}

/**
 * Returns the orphaned workspace worktree entries for a thread being deleted.
 * If the thread has `worktreeEntries` (multi-repo workspace worktree) and no
 * other thread shares the same `worktreePath`, returns those entries.
 * Returns null if the thread has no entries or the worktree is shared.
 */
export function getOrphanedWorktreeEntriesForThread(
  threads: readonly Thread[],
  threadId: Thread["id"],
): { worktreePath: string; entries: WorkspaceWorktreeEntry[] } | null {
  const targetThread = threads.find((thread) => thread.id === threadId);
  if (!targetThread) return null;
  if (!targetThread.worktreeEntries || targetThread.worktreeEntries.length === 0) return null;

  const targetWorktreePath = normalizeWorktreePath(targetThread.worktreePath);
  if (!targetWorktreePath) return null;

  const isShared = threads.some((thread) => {
    if (thread.id === threadId) return false;
    return normalizeWorktreePath(thread.worktreePath) === targetWorktreePath;
  });

  return isShared ? null : { worktreePath: targetWorktreePath, entries: targetThread.worktreeEntries };
}

/**
 * Returns true if the thread uses multi-repo workspace worktrees (has entries).
 */
export function isMultiRepoWorktreeThread(thread: Thread): boolean {
  return thread.worktreeEntries.length > 0 && thread.worktreePath !== null;
}

export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim();
  if (!trimmed) {
    return worktreePath;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  const lastPart = parts[parts.length - 1]?.trim() ?? "";
  return lastPart.length > 0 ? lastPart : trimmed;
}
