import { Effect, FileSystem, Layer, Path } from "effect";
import { randomUUID } from "node:crypto";

import { runProcess } from "../../processRunner";
import { ForgeCliError } from "../Errors.ts";
import { ForgeCli, type ForgeCliShape, type ForgeReviewRequestSummary } from "../Services/ForgeCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const PROVIDER = "github" as const;

function normalizeError(operation: string, error: unknown): ForgeCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new ForgeCliError({
        provider: PROVIDER,
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token")
    ) {
      return new ForgeCliError({
        provider: PROVIDER,
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        cause: error,
      });
    }

    return new ForgeCliError({
      provider: PROVIDER,
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new ForgeCliError({
    provider: PROVIDER,
    operation,
    detail: "GitHub CLI command failed.",
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
      runProcess("gh", input.args, {
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      }),
    catch: (error) => normalizeError("execute", error),
  });
}

export function parseGitHubPrList(raw: string): ForgeReviewRequestSummary[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub CLI returned non-array JSON.");
  }

  const result: ForgeReviewRequestSummary[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const number = record.number;
    const title = record.title;
    const url = record.url;
    const baseRefName = record.baseRefName;
    const headRefName = record.headRefName;
    const state = record.state;
    const mergedAt = record.mergedAt;
    const updatedAt = record.updatedAt;

    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number <= 0 ||
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof baseRefName !== "string" ||
      typeof headRefName !== "string"
    ) {
      continue;
    }

    let normalizedState: "open" | "closed" | "merged";
    if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
      normalizedState = "merged";
    } else if (state === "OPEN" || state === undefined || state === null) {
      normalizedState = "open";
    } else if (state === "CLOSED") {
      normalizedState = "closed";
    } else {
      continue;
    }

    result.push({
      number,
      title,
      url,
      baseBranch: baseRefName,
      headBranch: headRefName,
      state: normalizedState,
      updatedAt: typeof updatedAt === "string" && updatedAt.trim().length > 0 ? updatedAt : null,
    });
  }

  return result;
}

export const makeGitHubForgeCliShape = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const service: ForgeCliShape = {
    provider: PROVIDER,

    findOpenReviewRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headBranch,
          "--state",
          "open",
          "--limit",
          "1",
          "--json",
          "number,title,url,baseRefName,headRefName",
        ],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => parseGitHubPrList(raw),
            catch: (error: unknown) =>
              new ForgeCliError({
                provider: PROVIDER,
                operation: "findOpenReviewRequest",
                detail:
                  error instanceof Error
                    ? `GitHub CLI returned invalid PR list JSON: ${error.message}`
                    : "GitHub CLI returned invalid PR list JSON.",
                ...(error !== undefined ? { cause: error } : {}),
              }),
          }),
        ),
        Effect.map((prs) => prs[0] ?? null),
      ),

    findLatestReviewRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headBranch,
          "--state",
          "all",
          "--limit",
          String(input.limit ?? 20),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt",
        ],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.flatMap((raw) =>
          Effect.try({
            try: () => {
              const parsed = parseGitHubPrList(raw).toSorted((a, b) => {
                const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
                const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
                return right - left;
              });
              const latestOpen = parsed.find((pr) => pr.state === "open");
              return latestOpen ?? parsed[0] ?? null;
            },
            catch: (error: unknown) =>
              new ForgeCliError({
                provider: PROVIDER,
                operation: "findLatestReviewRequest",
                detail:
                  error instanceof Error
                    ? `GitHub CLI returned invalid PR list JSON: ${error.message}`
                    : "GitHub CLI returned invalid PR list JSON.",
                ...(error !== undefined ? { cause: error } : {}),
              }),
          }),
        ),
      ),

    createReviewRequest: (input) =>
      Effect.gen(function* () {
        const bodyFile = path.join(tempDir, `xbecode-pr-body-${process.pid}-${randomUUID()}.md`);
        yield* fileSystem
          .writeFileString(bodyFile, input.body)
          .pipe(
            Effect.mapError((cause) =>
              new ForgeCliError({
                provider: PROVIDER,
                operation: "createReviewRequest",
                detail: "Failed to write pull request body temp file.",
                cause,
              }),
            ),
          );
        yield* execute({
          cwd: input.cwd,
          args: [
            "pr",
            "create",
            "--base",
            input.baseBranch,
            "--head",
            input.headBranch,
            "--title",
            input.title,
            "--body-file",
            bodyFile,
          ],
        }).pipe(
          Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))),
        );
      }),

    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
  };

  return service;
});

export const GitHubForgeCliLive = Layer.effect(ForgeCli, makeGitHubForgeCliShape);
