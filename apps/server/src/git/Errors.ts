import { Schema } from "effect";

/**
 * GitCommandError - Git command execution failed.
 */
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()("GitCommandError", {
  operation: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Git command failed in ${this.operation}: ${this.command} (${this.cwd}) - ${this.detail}`;
  }
}

/**
 * ForgeCliError - Forge CLI (GitHub `gh` / GitLab `glab`) execution or authentication failed.
 */
export class ForgeCliError extends Schema.TaggedErrorClass<ForgeCliError>()("ForgeCliError", {
  provider: Schema.Literals(["github", "gitlab", "unknown"]),
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Forge CLI (${this.provider}) failed in ${this.operation}: ${this.detail}`;
  }
}

/**
 * @deprecated Use ForgeCliError instead.
 */
export const GitHubCliError = ForgeCliError;

/**
 * TextGenerationError - Commit or PR text generation failed.
 */
export class TextGenerationError extends Schema.TaggedErrorClass<TextGenerationError>()(
  "TextGenerationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Text generation failed in ${this.operation}: ${this.detail}`;
  }
}

/**
 * GitManagerError - Stacked Git workflow orchestration failed.
 */
export class GitManagerError extends Schema.TaggedErrorClass<GitManagerError>()("GitManagerError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Git manager failed in ${this.operation}: ${this.detail}`;
  }
}

/**
 * GitManagerServiceError - Errors emitted by stacked Git workflow orchestration.
 */
export type GitManagerServiceError =
  | GitManagerError
  | GitCommandError
  | ForgeCliError
  | TextGenerationError;
