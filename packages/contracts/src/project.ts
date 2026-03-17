import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH),
  ),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

// ── Directory Browser ───────────────────────────────────────────────

const DIRECTORY_LIST_PATH_MAX_LENGTH = 1024;

export const DirectoryListInput = Schema.Struct({
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(DIRECTORY_LIST_PATH_MAX_LENGTH)),
  showHidden: Schema.optional(Schema.Boolean),
});
export type DirectoryListInput = typeof DirectoryListInput.Type;

const DirectoryEntryKind = Schema.Literals(["file", "directory"]);

export const DirectoryEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  kind: DirectoryEntryKind,
  size: Schema.optional(Schema.Number),
  modifiedAt: Schema.optional(Schema.String),
});
export type DirectoryEntry = typeof DirectoryEntry.Type;

export const DirectoryListResult = Schema.Struct({
  entries: Schema.Array(DirectoryEntry),
  currentPath: TrimmedNonEmptyString,
  parentPath: Schema.NullOr(Schema.String),
});
export type DirectoryListResult = typeof DirectoryListResult.Type;
