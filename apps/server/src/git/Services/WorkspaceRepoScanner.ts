/**
 * WorkspaceRepoScanner - Effect service contract for discovering git
 * repositories within a workspace root directory.
 *
 * This is intentionally separate from GitCore which operates on a
 * single repository. Workspace scanning is a higher-level concern.
 *
 * @module WorkspaceRepoScanner
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";
import type { GitListWorkspaceReposInput, GitListWorkspaceReposResult } from "@xbetools/contracts";

import type { GitCommandError } from "../Errors.ts";

export interface WorkspaceRepoScannerShape {
  readonly listWorkspaceRepos: (
    input: GitListWorkspaceReposInput,
  ) => Effect.Effect<GitListWorkspaceReposResult, GitCommandError>;
}

export class WorkspaceRepoScanner extends ServiceMap.Service<
  WorkspaceRepoScanner,
  WorkspaceRepoScannerShape
>()("xbe/git/Services/WorkspaceRepoScanner") {}
