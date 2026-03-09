/**
 * ForgeCli - Provider-agnostic Effect service contract for forge CLI interactions.
 *
 * Abstracts GitHub (`gh`) and GitLab (`glab`) review request operations behind
 * a uniform interface. Implementations own all JSON parsing and state normalization.
 *
 * @module ForgeCli
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ForgeCliError } from "../Errors.ts";

export type ForgeProvider = "github" | "gitlab";

export interface ForgeReviewRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: string | null;
}

/**
 * ForgeCliShape - Service API for forge review request operations.
 *
 * Each implementation (GitHub, GitLab) owns its own CLI invocation, JSON parsing,
 * and state normalization. GitManager never sees raw provider CLI output.
 */
export interface ForgeCliShape {
  readonly provider: ForgeProvider;

  /**
   * Find the open review request for a head/source branch, if one exists.
   */
  readonly findOpenReviewRequest: (input: {
    readonly cwd: string;
    readonly headBranch: string;
  }) => Effect.Effect<ForgeReviewRequestSummary | null, ForgeCliError>;

  /**
   * Find the latest review request (any state) for a head/source branch.
   * Prefers open review requests over closed/merged ones.
   */
  readonly findLatestReviewRequest: (input: {
    readonly cwd: string;
    readonly headBranch: string;
    readonly limit?: number;
  }) => Effect.Effect<ForgeReviewRequestSummary | null, ForgeCliError>;

  /**
   * Create a new review request (PR on GitHub, MR on GitLab).
   * Body is passed as a string; the implementation decides how to deliver it.
   */
  readonly createReviewRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headBranch: string;
    readonly title: string;
    readonly body: string;
  }) => Effect.Effect<void, ForgeCliError>;

  /**
   * Resolve the repository's default branch name from forge metadata.
   */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, ForgeCliError>;
}

/**
 * ForgeCli - Service tag for forge CLI interactions.
 */
export class ForgeCli extends ServiceMap.Service<ForgeCli, ForgeCliShape>()(
  "xbe/git/Services/ForgeCli",
) {}
