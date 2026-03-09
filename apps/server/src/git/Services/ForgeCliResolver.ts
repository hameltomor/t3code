/**
 * ForgeCliResolver - Resolves the appropriate ForgeCli implementation for a repository.
 *
 * Detects the forge provider from git remote URL, explicit config, or environment
 * variable, then returns the matching ForgeCli (GitHub or GitLab). Caches per cwd.
 *
 * @module ForgeCliResolver
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ForgeCliError } from "../Errors.ts";
import type { GitCommandError } from "../Errors.ts";
import type { ForgeCliShape } from "./ForgeCli.ts";

/**
 * ForgeCliResolverShape - Service API for resolving the forge implementation per repo.
 */
export interface ForgeCliResolverShape {
  /**
   * Resolve the appropriate ForgeCli implementation for the given repository.
   * Detects provider via (in order): git config, env var, remote URL auto-detection.
   * Caches the result per cwd.
   */
  readonly resolve: (
    cwd: string,
  ) => Effect.Effect<ForgeCliShape, ForgeCliError | GitCommandError>;
}

/**
 * ForgeCliResolver - Service tag for forge CLI resolution.
 */
export class ForgeCliResolver extends ServiceMap.Service<
  ForgeCliResolver,
  ForgeCliResolverShape
>()("xbe/git/Services/ForgeCliResolver") {}
