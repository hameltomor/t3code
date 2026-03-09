import { Effect, Layer } from "effect";
import { detectForgeProviderFromRemoteUrl, type ForgeProvider } from "@xbetools/shared/git";

import { ForgeCliError } from "../Errors.ts";
import { GitCore } from "../Services/GitCore.ts";
import { type ForgeCliShape } from "../Services/ForgeCli.ts";
import { ForgeCliResolver, type ForgeCliResolverShape } from "../Services/ForgeCliResolver.ts";
import { makeGitHubForgeCliShape } from "./GitHubForgeCli.ts";
import { makeGitLabForgeCliShape } from "./GitLabForgeCli.ts";

/**
 * Detect the forge provider for a repository.
 *
 * Resolution order:
 * 1. Git config: `xbecode.forge-provider`
 * 2. Environment variable: `XBECODE_FORGE_PROVIDER`
 * 3. Auto-detect from `git remote get-url origin`
 *
 * Returns null if unknown — callers must handle that case.
 */
export function resolveForgeProvider(
  configValue: string | null,
  envValue: string | undefined,
  remoteUrl: string | null,
): ForgeProvider | null {
  // 1. Explicit git config
  if (configValue === "github" || configValue === "gitlab") {
    return configValue;
  }

  // 2. Explicit env var
  const env = envValue?.toLowerCase().trim();
  if (env === "github" || env === "gitlab") {
    return env;
  }

  // 3. Auto-detect from remote URL
  if (remoteUrl) {
    return detectForgeProviderFromRemoteUrl(remoteUrl);
  }

  return null;
}

const makeForgeCliResolver = Effect.gen(function* () {
  const gitCore = yield* GitCore;

  // Pre-build the GitHub shape eagerly so its FileSystem/Path deps are satisfied
  // at construction time rather than at each resolve() call.
  const githubShape = yield* makeGitHubForgeCliShape;
  const gitlabShape = yield* makeGitLabForgeCliShape;

  // Cache resolved forge per cwd to avoid repeated detection
  const cache = new Map<string, ForgeCliShape>();

  const resolve: ForgeCliResolverShape["resolve"] = (cwd) =>
    Effect.gen(function* () {
      const cached = cache.get(cwd);
      if (cached) return cached;

      const configValue = yield* gitCore
        .readConfigValue(cwd, "xbecode.forge-provider")
        .pipe(Effect.catch(() => Effect.succeed(null)));

      const envValue = process.env.XBECODE_FORGE_PROVIDER;

      const remoteUrl = yield* gitCore
        .getOriginRemoteUrl(cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));

      const provider = resolveForgeProvider(configValue, envValue, remoteUrl);

      if (!provider) {
        return yield* new ForgeCliError({
          provider: "unknown",
          operation: "resolveForgeProvider",
          detail:
            "Could not detect forge provider from git remote. Set `git config xbecode.forge-provider github` or `git config xbecode.forge-provider gitlab`.",
        });
      }

      const forgeShape = provider === "github" ? githubShape : gitlabShape;

      cache.set(cwd, forgeShape);
      return forgeShape;
    });

  return { resolve } satisfies ForgeCliResolverShape;
});

export const ForgeCliResolverLive = Layer.effect(ForgeCliResolver, makeForgeCliResolver);
