import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;

// Domain Types

export const GitStackedAction = Schema.Literals(["commit", "commit_push", "commit_push_pr"]);
export type GitStackedAction = typeof GitStackedAction.Type;
const GitCommitStepStatus = Schema.Literals(["created", "skipped_no_changes"]);
const GitPushStepStatus = Schema.Literals([
  "pushed",
  "skipped_not_requested",
  "skipped_up_to_date",
]);
const GitBranchStepStatus = Schema.Literals(["created", "skipped_not_requested"]);
const GitPrStepStatus = Schema.Literals([
  "created",
  "opened_existing",
  "skipped_not_requested",
]);
const GitStatusPrState = Schema.Literals(["open", "closed", "merged"]);

export const GitBranch = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitBranch = typeof GitBranch.Type;

const GitWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});

// RPC Inputs

export const GitStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitStatusInput = typeof GitStatusInput.Type;

export const GitPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitPullInput = typeof GitPullInput.Type;

export const GitRunStackedActionInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
  commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
  featureBranch: Schema.optional(Schema.Boolean),
  filePaths: Schema.optional(
    Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
  ),
  /** Codex model slug to use for AI-generated git text (commit messages, PR content, branch names). */
  textGenerationModel: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(256))),
});
export type GitRunStackedActionInput = typeof GitRunStackedActionInput.Type;

export const GitListBranchesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitListBranchesInput = typeof GitListBranchesInput.Type;

export const GitCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  newBranch: TrimmedNonEmptyStringSchema,
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type GitCreateWorktreeInput = typeof GitCreateWorktreeInput.Type;

export const GitRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
});
export type GitRemoveWorktreeInput = typeof GitRemoveWorktreeInput.Type;

export const GitCreateBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitCreateBranchInput = typeof GitCreateBranchInput.Type;

export const GitCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export type GitCheckoutInput = typeof GitCheckoutInput.Type;

export const GitInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitInitInput = typeof GitInitInput.Type;

// RPC Results

const GitStatusPr = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitStatusPrState,
});

const ForgeProviderSchema = Schema.Literals(["github", "gitlab", "unknown"]);

export const GitStatusResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: TrimmedNonEmptyStringSchema,
        insertions: NonNegativeInt,
        deletions: NonNegativeInt,
      }),
    ),
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
  hasUpstream: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  forgeProvider: Schema.optional(ForgeProviderSchema),
  pr: Schema.NullOr(GitStatusPr),
});
export type GitStatusResult = typeof GitStatusResult.Type;

export const GitListBranchesResult = Schema.Struct({
  branches: Schema.Array(GitBranch),
  isRepo: Schema.Boolean,
});
export type GitListBranchesResult = typeof GitListBranchesResult.Type;

export const GitCreateWorktreeResult = Schema.Struct({
  worktree: GitWorktree,
});
export type GitCreateWorktreeResult = typeof GitCreateWorktreeResult.Type;

export const GitRunStackedActionResult = Schema.Struct({
  action: GitStackedAction,
  branch: Schema.Struct({
    status: GitBranchStepStatus,
    name: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  commit: Schema.Struct({
    status: GitCommitStepStatus,
    commitSha: Schema.optional(TrimmedNonEmptyStringSchema),
    subject: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  push: Schema.Struct({
    status: GitPushStepStatus,
    branch: Schema.optional(TrimmedNonEmptyStringSchema),
    upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    setUpstream: Schema.optional(Schema.Boolean),
  }),
  pr: Schema.Struct({
    status: GitPrStepStatus,
    url: Schema.optional(Schema.String),
    number: Schema.optional(PositiveInt),
    baseBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    headBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    title: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
});
export type GitRunStackedActionResult = typeof GitRunStackedActionResult.Type;

export const GitPullResult = Schema.Struct({
  status: Schema.Literals(["pulled", "skipped_up_to_date"]),
  branch: TrimmedNonEmptyStringSchema,
  upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type GitPullResult = typeof GitPullResult.Type;

// ── Workspace Repos ─────────────────────────────────────────────────

export const GitListWorkspaceReposInput = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyStringSchema,
  maxDepth: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
});
export type GitListWorkspaceReposInput = typeof GitListWorkspaceReposInput.Type;

const WorkspaceRepoSummaryPr = Schema.Struct({
  number: PositiveInt,
  url: Schema.String,
  state: GitStatusPrState,
});

export const WorkspaceRepoSummary = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  name: TrimmedNonEmptyStringSchema,
  relativePath: TrimmedNonEmptyStringSchema,
  isRoot: Schema.Boolean,
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  hasChanges: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  pr: Schema.NullOr(WorkspaceRepoSummaryPr),
});
export type WorkspaceRepoSummary = typeof WorkspaceRepoSummary.Type;

export const GitListWorkspaceReposResult = Schema.Struct({
  repos: Schema.Array(WorkspaceRepoSummary),
});
export type GitListWorkspaceReposResult = typeof GitListWorkspaceReposResult.Type;

// ── Workspace Worktrees ─────────────────────────────────────────────

const WorkspaceWorktreeRepoInput = Schema.Struct({
  /** Absolute path to the original repo (e.g. /home/user/price-bee-2/horizon) */
  repoPath: TrimmedNonEmptyStringSchema,
  /** Base branch to create the worktree from */
  branch: TrimmedNonEmptyStringSchema,
  /** New branch name for the worktree */
  newBranch: TrimmedNonEmptyStringSchema,
});

export const GitCreateWorkspaceWorktreesInput = Schema.Struct({
  /** Absolute path to the workspace root (parent of all repos) */
  workspaceRoot: TrimmedNonEmptyStringSchema,
  /** Per-repo worktree inputs */
  repos: Schema.Array(WorkspaceWorktreeRepoInput),
  /** Slug used to name the synthetic workspace directory */
  slug: TrimmedNonEmptyStringSchema,
});
export type GitCreateWorkspaceWorktreesInput = typeof GitCreateWorkspaceWorktreesInput.Type;

const WorkspaceWorktreeEntry = Schema.Struct({
  /** Name of the repo (e.g. "horizon") */
  name: TrimmedNonEmptyStringSchema,
  /** Relative path within the workspace (e.g. "./horizon") */
  relativePath: TrimmedNonEmptyStringSchema,
  /** Absolute path to the original repo */
  originalPath: TrimmedNonEmptyStringSchema,
  /** Absolute path to the created worktree */
  worktreePath: TrimmedNonEmptyStringSchema,
  /** Branch name in the worktree */
  branch: TrimmedNonEmptyStringSchema,
});
export { WorkspaceWorktreeEntry };
export type WorkspaceWorktreeEntry = typeof WorkspaceWorktreeEntry.Type;

export const GitCreateWorkspaceWorktreesResult = Schema.Struct({
  /** Absolute path to the synthetic workspace root */
  workspaceWorktreePath: TrimmedNonEmptyStringSchema,
  entries: Schema.Array(WorkspaceWorktreeEntry),
});
export type GitCreateWorkspaceWorktreesResult = typeof GitCreateWorkspaceWorktreesResult.Type;

export const GitRemoveWorkspaceWorktreesInput = Schema.Struct({
  /** Absolute path to the synthetic workspace root to remove */
  workspaceWorktreePath: TrimmedNonEmptyStringSchema,
  /** Per-repo cleanup: original repo path + worktree path */
  entries: Schema.Array(
    Schema.Struct({
      repoPath: TrimmedNonEmptyStringSchema,
      worktreePath: TrimmedNonEmptyStringSchema,
    }),
  ),
  force: Schema.optional(Schema.Boolean),
});
export type GitRemoveWorkspaceWorktreesInput = typeof GitRemoveWorkspaceWorktreesInput.Type;
