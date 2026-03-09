import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { ForgeCliError } from "../Errors.ts";
import { ForgeCli, type ForgeCliShape, type ForgeReviewRequestSummary } from "../Services/ForgeCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const PROVIDER = "gitlab" as const;

function normalizeError(operation: string, error: unknown): ForgeCliError {
  if (error instanceof Error) {
    if (
      error.message.includes("Command not found: glab") ||
      error.message.includes("command not found: glab")
    ) {
      return new ForgeCliError({
        provider: PROVIDER,
        operation,
        detail: "GitLab CLI (`glab`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("glab auth login") ||
      lower.includes("401") ||
      lower.includes("unauthorized")
    ) {
      return new ForgeCliError({
        provider: PROVIDER,
        operation,
        detail: "GitLab CLI is not authenticated. Run `glab auth login` and retry.",
        cause: error,
      });
    }

    return new ForgeCliError({
      provider: PROVIDER,
      operation,
      detail: `GitLab CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new ForgeCliError({
    provider: PROVIDER,
    operation,
    detail: "GitLab CLI command failed.",
    cause: error,
  });
}

function execute(input: {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}) {
  return Effect.tryPromise({
    try: () =>
      runProcess("glab", input.args, {
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    catch: (error) => normalizeError("execute", error),
  });
}

export function parseGitLabMrList(raw: string): ForgeReviewRequestSummary[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("GitLab CLI returned non-array JSON.");
  }

  const result: ForgeReviewRequestSummary[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;

    // glab uses `iid` for the project-scoped MR number
    const iid = record.iid;
    const title = record.title;
    const webUrl = record.web_url;
    const sourceBranch = record.source_branch;
    const targetBranch = record.target_branch;
    const state = record.state;
    const updatedAt = record.updated_at;

    const number = typeof iid === "number" ? iid : typeof iid === "string" ? parseInt(iid, 10) : NaN;
    if (!Number.isInteger(number) || number <= 0) continue;
    if (
      typeof title !== "string" ||
      typeof webUrl !== "string" ||
      typeof sourceBranch !== "string" ||
      typeof targetBranch !== "string"
    ) {
      continue;
    }

    // glab states: "opened", "closed", "merged", "locked"
    let normalizedState: "open" | "closed" | "merged";
    if (state === "merged") {
      normalizedState = "merged";
    } else if (state === "opened") {
      normalizedState = "open";
    } else if (state === "closed" || state === "locked") {
      normalizedState = "closed";
    } else {
      continue;
    }

    result.push({
      number,
      title,
      url: webUrl,
      baseBranch: targetBranch,
      headBranch: sourceBranch,
      state: normalizedState,
      updatedAt: typeof updatedAt === "string" && updatedAt.trim().length > 0 ? updatedAt : null,
    });
  }

  return result;
}

export const makeGitLabForgeCliShape = Effect.sync(() => {
  const service: ForgeCliShape = {
    provider: PROVIDER,

    findOpenReviewRequest: (input) =>
      execute({
        cwd: input.cwd,
        // glab mr list defaults to open MRs — no --state flag needed.
        args: [
          "mr",
          "list",
          "--source-branch",
          input.headBranch,
          "-F",
          "json",
          "-P",
          "1",
        ],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => parseGitLabMrList(raw),
            catch: (error: unknown) =>
              new ForgeCliError({
                provider: PROVIDER,
                operation: "findOpenReviewRequest",
                detail:
                  error instanceof Error
                    ? `GitLab CLI returned invalid MR list JSON: ${error.message}`
                    : "GitLab CLI returned invalid MR list JSON.",
                ...(error !== undefined ? { cause: error } : {}),
              }),
          }),
        ),
        Effect.map((mrs) => mrs[0] ?? null),
      ),

    findLatestReviewRequest: (input) =>
      execute({
        cwd: input.cwd,
        // --all shows all states; filter and sort locally.
        args: [
          "mr",
          "list",
          "--all",
          "--source-branch",
          input.headBranch,
          "-F",
          "json",
          "-P",
          String(input.limit ?? 20),
        ],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => {
              const parsed = parseGitLabMrList(raw).toSorted((a, b) => {
                const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
                const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
                return right - left;
              });
              const latestOpen = parsed.find((mr) => mr.state === "open");
              return latestOpen ?? parsed[0] ?? null;
            },
            catch: (error: unknown) =>
              new ForgeCliError({
                provider: PROVIDER,
                operation: "findLatestReviewRequest",
                detail:
                  error instanceof Error
                    ? `GitLab CLI returned invalid MR list JSON: ${error.message}`
                    : "GitLab CLI returned invalid MR list JSON.",
                ...(error !== undefined ? { cause: error } : {}),
              }),
          }),
        ),
      ),

    createReviewRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "mr",
          "create",
          "-b",
          input.baseBranch,
          "-s",
          input.headBranch,
          "-t",
          input.title,
          "-d",
          input.body,
          "--yes",
        ],
      }).pipe(Effect.asVoid),

    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "-F", "json"],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => {
              const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
              const defaultBranch = parsed.default_branch;
              if (typeof defaultBranch === "string" && defaultBranch.trim().length > 0) {
                return defaultBranch.trim();
              }
              return null;
            },
            catch: () =>
              new ForgeCliError({
                provider: PROVIDER,
                operation: "getDefaultBranch",
                detail: "GitLab CLI returned invalid repo JSON.",
              }),
          }),
        ),
      ),
  };

  return service;
});

export const GitLabForgeCliLive = Layer.effect(ForgeCli, makeGitLabForgeCliShape);
