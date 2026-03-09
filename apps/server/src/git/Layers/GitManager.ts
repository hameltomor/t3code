import { Effect, Layer } from "effect";
import { resolveAutoFeatureBranchName, sanitizeFeatureBranchName } from "@xbetools/shared/git";

import { GitManagerError } from "../Errors.ts";
import { GitManager, type GitManagerShape } from "../Services/GitManager.ts";
import { GitCore } from "../Services/GitCore.ts";
import { ForgeCliResolver } from "../Services/ForgeCliResolver.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import type { ForgeCliShape, ForgeReviewRequestSummary } from "../Services/ForgeCli.ts";

function gitManagerError(operation: string, detail: string, cause?: unknown): GitManagerError {
  return new GitManagerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function sanitizeCommitMessage(generated: {
  subject: string;
  body: string;
  branch?: string | undefined;
}): {
  subject: string;
  body: string;
  branch?: string | undefined;
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const subject = rawSubject.replace(/[.]+$/g, "").trim();
  const safeSubject = subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Update project files";
  return {
    subject: safeSubject,
    body: generated.body.trim(),
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
  };
}

interface CommitAndBranchSuggestion {
  subject: string;
  body: string;
  branch?: string | undefined;
  commitMessage: string;
}

function formatCommitMessage(subject: string, body: string): string {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return subject;
  }
  return `${subject}\n\n${trimmedBody}`;
}

function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  const [firstLine, ...rest] = normalized.split("\n");
  const subject = firstLine?.trim() ?? "";
  if (subject.length === 0) {
    return null;
  }

  return {
    subject,
    body: rest.join("\n").trim(),
  };
}

function extractBranchFromRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.startsWith("refs/remotes/")) {
    const withoutPrefix = normalized.slice("refs/remotes/".length);
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return withoutPrefix.trim();
    }
    return withoutPrefix.slice(firstSlash + 1).trim();
  }

  const firstSlash = normalized.indexOf("/");
  if (firstSlash === -1) {
    return normalized;
  }
  return normalized.slice(firstSlash + 1).trim();
}

function toStatusPr(rr: ForgeReviewRequestSummary): {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
} {
  return {
    number: rr.number,
    title: rr.title,
    url: rr.url,
    baseBranch: rr.baseBranch,
    headBranch: rr.headBranch,
    state: rr.state,
  };
}

export const makeGitManager = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const forgeCliResolver = yield* ForgeCliResolver;
  const textGeneration = yield* TextGeneration;

  /**
   * Resolve the forge CLI for a repository. All review request operations
   * go through this — GitManager never does raw CLI execution.
   */
  const resolveForge = (cwd: string) =>
    forgeCliResolver.resolve(cwd).pipe(Effect.catch(() => Effect.succeed(null as ForgeCliShape | null)));

  const resolveBaseBranch = (
    cwd: string,
    branch: string,
    upstreamRef: string | null,
    forge: ForgeCliShape | null,
  ) =>
    Effect.gen(function* () {
      // 1. Neutral config key (new canonical)
      const neutralConfigured = yield* gitCore.readConfigValue(cwd, `branch.${branch}.merge-base`);
      if (neutralConfigured) return neutralConfigured;

      // 2. Legacy GitHub-specific config key (backward compat)
      const ghConfigured = yield* gitCore.readConfigValue(cwd, `branch.${branch}.gh-merge-base`);
      if (ghConfigured) return ghConfigured;

      // 3. Extract from upstream ref if set
      if (upstreamRef) {
        const upstreamBranch = extractBranchFromRef(upstreamRef);
        if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
          return upstreamBranch;
        }
      }

      // 4. Forge CLI default branch lookup
      if (forge) {
        const defaultFromForge = yield* forge
          .getDefaultBranch({ cwd })
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (defaultFromForge) {
          return defaultFromForge;
        }
      }

      return "main";
    });

  const resolveCommitAndBranchSuggestion = (input: {
    cwd: string;
    branch: string | null;
    commitMessage?: string;
    includeBranch?: boolean;
  }) =>
    Effect.gen(function* () {
      const context = yield* gitCore.prepareCommitContext(input.cwd);
      if (!context) {
        return null;
      }

      const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
      if (customCommit) {
        return {
          subject: customCommit.subject,
          body: customCommit.body,
          ...(input.includeBranch
            ? { branch: sanitizeFeatureBranchName(customCommit.subject) }
            : {}),
          commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
        };
      }

      const generated = yield* textGeneration
        .generateCommitMessage({
          cwd: input.cwd,
          branch: input.branch,
          stagedSummary: limitContext(context.stagedSummary, 8_000),
          stagedPatch: limitContext(context.stagedPatch, 50_000),
          ...(input.includeBranch ? { includeBranch: true } : {}),
        })
        .pipe(Effect.map((result) => sanitizeCommitMessage(result)));

      return {
        subject: generated.subject,
        body: generated.body,
        ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
        commitMessage: formatCommitMessage(generated.subject, generated.body),
      };
    });

  const runCommitStep = (
    cwd: string,
    branch: string | null,
    commitMessage?: string,
    preResolvedSuggestion?: CommitAndBranchSuggestion,
  ) =>
    Effect.gen(function* () {
      const suggestion =
        preResolvedSuggestion ??
        (yield* resolveCommitAndBranchSuggestion({
          cwd,
          branch,
          ...(commitMessage ? { commitMessage } : {}),
        }));
      if (!suggestion) {
        return { status: "skipped_no_changes" as const };
      }

      const { commitSha } = yield* gitCore.commit(cwd, suggestion.subject, suggestion.body);
      return {
        status: "created" as const,
        commitSha,
        subject: suggestion.subject,
      };
    });

  const runPrStep = (cwd: string, fallbackBranch: string | null) =>
    Effect.gen(function* () {
      const details = yield* gitCore.statusDetails(cwd);
      const branch = details.branch ?? fallbackBranch;
      if (!branch) {
        return yield* gitManagerError(
          "runPrStep",
          "Cannot create a review request from detached HEAD.",
        );
      }
      if (!details.hasUpstream) {
        return yield* gitManagerError(
          "runPrStep",
          "Current branch has not been pushed. Push before creating a review request.",
        );
      }

      const forge = yield* resolveForge(cwd);
      if (!forge) {
        return yield* gitManagerError(
          "runPrStep",
          "Could not detect forge provider. Set `git config xbecode.forge-provider github` or `gitlab`.",
        );
      }

      const existing = yield* forge.findOpenReviewRequest({ cwd, headBranch: branch });
      if (existing) {
        return {
          status: "opened_existing" as const,
          url: existing.url,
          number: existing.number,
          baseBranch: existing.baseBranch,
          headBranch: existing.headBranch,
          title: existing.title,
        };
      }

      const baseBranch = yield* resolveBaseBranch(cwd, branch, details.upstreamRef, forge);
      const rangeContext = yield* gitCore.readRangeContext(cwd, baseBranch);

      const generated = yield* textGeneration.generatePrContent({
        cwd,
        baseBranch,
        headBranch: branch,
        commitSummary: limitContext(rangeContext.commitSummary, 20_000),
        diffSummary: limitContext(rangeContext.diffSummary, 20_000),
        diffPatch: limitContext(rangeContext.diffPatch, 60_000),
      });

      yield* forge.createReviewRequest({
        cwd,
        baseBranch,
        headBranch: branch,
        title: generated.title,
        body: generated.body,
      });

      const created = yield* forge.findOpenReviewRequest({ cwd, headBranch: branch });
      if (!created) {
        return {
          status: "created" as const,
          baseBranch,
          headBranch: branch,
          title: generated.title,
        };
      }

      return {
        status: "created" as const,
        url: created.url,
        number: created.number,
        baseBranch: created.baseBranch,
        headBranch: created.headBranch,
        title: created.title,
      };
    });

  const status: GitManagerShape["status"] = Effect.fnUntraced(function* (input) {
    const details = yield* gitCore.statusDetails(input.cwd);

    const forge = yield* resolveForge(input.cwd);
    const forgeProvider = forge?.provider ?? "unknown";

    const pr =
      details.branch !== null && forge
        ? yield* forge
            .findLatestReviewRequest({ cwd: input.cwd, headBranch: details.branch, limit: 20 })
            .pipe(
              Effect.map((latest) => (latest ? toStatusPr(latest) : null)),
              Effect.catch(() => Effect.succeed(null)),
            )
        : null;

    return {
      branch: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
      hasUpstream: details.hasUpstream,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      forgeProvider,
      pr,
    };
  });

  const runFeatureBranchStep = (cwd: string, branch: string | null, commitMessage?: string) =>
    Effect.gen(function* () {
      const suggestion = yield* resolveCommitAndBranchSuggestion({
        cwd,
        branch,
        ...(commitMessage ? { commitMessage } : {}),
        includeBranch: true,
      });
      if (!suggestion) {
        return yield* gitManagerError(
          "runFeatureBranchStep",
          "Cannot create a feature branch because there are no changes to commit.",
        );
      }

      const preferredBranch = suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
      const existingBranchNames = yield* gitCore.listLocalBranchNames(cwd);
      const resolvedBranch = resolveAutoFeatureBranchName(existingBranchNames, preferredBranch);

      yield* gitCore.createBranch({ cwd, branch: resolvedBranch });
      yield* Effect.scoped(gitCore.checkoutBranch({ cwd, branch: resolvedBranch }));

      return {
        branchStep: { status: "created" as const, name: resolvedBranch },
        resolvedCommitMessage: suggestion.commitMessage,
        resolvedCommitSuggestion: suggestion,
      };
    });

  const runStackedAction: GitManagerShape["runStackedAction"] = Effect.fnUntraced(
    function* (input) {
      const wantsPush = input.action !== "commit";
      const wantsPr = input.action === "commit_push_pr";

      const initialStatus = yield* gitCore.statusDetails(input.cwd);
      if (!input.featureBranch && wantsPush && !initialStatus.branch) {
        return yield* gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
      }
      if (!input.featureBranch && wantsPr && !initialStatus.branch) {
        return yield* gitManagerError(
          "runStackedAction",
          "Cannot create a review request from detached HEAD.",
        );
      }

      let branchStep: { status: "created" | "skipped_not_requested"; name?: string };
      let commitMessageForStep = input.commitMessage;
      let preResolvedCommitSuggestion: CommitAndBranchSuggestion | undefined = undefined;

      if (input.featureBranch) {
        const result = yield* runFeatureBranchStep(
          input.cwd,
          initialStatus.branch,
          input.commitMessage,
        );
        branchStep = result.branchStep;
        commitMessageForStep = result.resolvedCommitMessage;
        preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
      } else {
        branchStep = { status: "skipped_not_requested" as const };
      }

      const currentBranch = branchStep.name ?? initialStatus.branch;

      const commit = yield* runCommitStep(
        input.cwd,
        currentBranch,
        commitMessageForStep,
        preResolvedCommitSuggestion,
      );

      const push = wantsPush
        ? yield* gitCore.pushCurrentBranch(input.cwd, currentBranch)
        : { status: "skipped_not_requested" as const };

      const pr = wantsPr
        ? yield* runPrStep(input.cwd, currentBranch)
        : { status: "skipped_not_requested" as const };

      return {
        action: input.action,
        branch: branchStep,
        commit,
        push,
        pr,
      };
    },
  );

  return {
    status,
    runStackedAction,
  } satisfies GitManagerShape;
});

export const GitManagerLive = Layer.effect(GitManager, makeGitManager);
