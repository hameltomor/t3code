import { readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

import { Effect, Layer } from "effect";
import type { WorkspaceRepoSummary } from "@xbetools/contracts";

import { GitManager } from "../Services/GitManager.ts";
import {
  WorkspaceRepoScanner,
  type WorkspaceRepoScannerShape,
} from "../Services/WorkspaceRepoScanner.ts";

const DEFAULT_MAX_DEPTH = 1;

function isGitRepo(dirPath: string): boolean {
  return existsSync(join(dirPath, ".git"));
}

function discoverRepoPaths(root: string, maxDepth: number): string[] {
  const repos: string[] = [];

  if (isGitRepo(root)) {
    repos.push(root);
  }

  if (maxDepth >= 1) {
    scanChildren(root, 1, maxDepth, repos);
  }

  return repos;
}

function scanChildren(dir: string, currentDepth: number, maxDepth: number, repos: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (entry === "node_modules") continue;

    const childPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(childPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    if (isGitRepo(childPath)) {
      repos.push(childPath);
    } else if (currentDepth < maxDepth) {
      scanChildren(childPath, currentDepth + 1, maxDepth, repos);
    }
  }
}

export const makeWorkspaceRepoScanner = Effect.gen(function* () {
  const gitManager = yield* GitManager;

  const listWorkspaceRepos: WorkspaceRepoScannerShape["listWorkspaceRepos"] = (input) =>
    Effect.gen(function* () {
      const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
      const repoPaths = discoverRepoPaths(input.workspaceRoot, maxDepth);

      if (repoPaths.length === 0) {
        return { repos: [] };
      }

      const summaries = yield* Effect.all(
        repoPaths.map((repoPath) =>
          gitManager.status({ cwd: repoPath }).pipe(
            Effect.map(
              (status): WorkspaceRepoSummary => ({
                path: repoPath,
                name: basename(repoPath),
                relativePath:
                  repoPath === input.workspaceRoot ? "." : relative(input.workspaceRoot, repoPath),
                isRoot: repoPath === input.workspaceRoot,
                branch: status.branch,
                hasChanges: status.hasWorkingTreeChanges,
                aheadCount: status.aheadCount,
                behindCount: status.behindCount,
                pr: status.pr
                  ? { number: status.pr.number, url: status.pr.url, state: status.pr.state }
                  : null,
              }),
            ),
            Effect.catch(() =>
              Effect.succeed<WorkspaceRepoSummary>({
                path: repoPath,
                name: basename(repoPath),
                relativePath:
                  repoPath === input.workspaceRoot ? "." : relative(input.workspaceRoot, repoPath),
                isRoot: repoPath === input.workspaceRoot,
                branch: null,
                hasChanges: false,
                aheadCount: 0,
                behindCount: 0,
                pr: null,
              }),
            ),
          ),
        ),
        { concurrency: "unbounded" },
      );

      summaries.sort((a, b) => {
        if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { repos: summaries };
    });

  return { listWorkspaceRepos } satisfies WorkspaceRepoScannerShape;
});

export const WorkspaceRepoScannerLive = Layer.effect(WorkspaceRepoScanner, makeWorkspaceRepoScanner);
