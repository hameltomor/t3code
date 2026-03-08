import { Encoding } from "effect";
import { CheckpointRef, ProjectId, type ThreadId } from "@xbetools/contracts";

export const CHECKPOINT_REFS_PREFIX = "refs/xbe/checkpoints";

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.makeUnsafe(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

type ThreadCwdInput = {
  readonly thread: {
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
    readonly worktreeEntries?: ReadonlyArray<{ readonly worktreePath: string }>;
  };
  readonly projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly workspaceRoot: string;
  }>;
};

/**
 * Resolve the effective git working directory for checkpoint/diff operations.
 *
 * For single-repo worktree threads: returns `worktreePath` (a real git worktree).
 * For multi-repo worktree threads: returns the first worktree entry's path
 * (the primary git repo inside the synthetic workspace root).
 * For local threads: falls back to the project's workspace root.
 *
 * NOTE: Do NOT use this for provider session CWD — the provider needs the
 * synthetic workspace root to see all repos. Use `resolveThreadProviderCwd` instead.
 */
export function resolveThreadWorkspaceCwd(input: ThreadCwdInput): string | undefined {
  // Multi-repo workspace worktree: the thread's worktreePath is a synthetic
  // root (not a git repo). Use the first worktree entry which is a real git repo.
  const entries = input.thread.worktreeEntries;
  if (entries && entries.length > 0 && entries[0]) {
    return entries[0].worktreePath;
  }

  // Single-repo worktree or no worktree at all.
  const worktreeCwd = input.thread.worktreePath ?? undefined;
  if (worktreeCwd) {
    return worktreeCwd;
  }

  return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}

/**
 * Resolve the effective working directory for a provider session.
 *
 * For multi-repo worktree threads: returns `worktreePath` (the synthetic workspace
 * root) so the AI agent can see all repos in the workspace.
 * For single-repo worktree threads: returns `worktreePath` (a real git worktree).
 * For local threads: falls back to the project's workspace root.
 *
 * This differs from `resolveThreadWorkspaceCwd` which returns a real git repo
 * path suitable for checkpoint/diff operations.
 */
export function resolveThreadProviderCwd(input: ThreadCwdInput): string | undefined {
  // For provider sessions, always use worktreePath directly — even for multi-repo
  // threads. The synthetic root contains all repo worktrees + symlinks, giving
  // the AI agent full visibility into the workspace.
  const worktreeCwd = input.thread.worktreePath ?? undefined;
  if (worktreeCwd) {
    return worktreeCwd;
  }

  return input.projects.find((project) => project.id === input.thread.projectId)?.workspaceRoot;
}
