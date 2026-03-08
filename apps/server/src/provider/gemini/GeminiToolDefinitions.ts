/**
 * GeminiToolDefinitions - Tool surface exposed to Gemini for agent behavior.
 *
 * Defines the function declarations sent to Gemini so it can decide when to
 * call tools. Also maps Gemini tool names to canonical item types used by the
 * runtime event pipeline.
 *
 * @module GeminiToolDefinitions
 */
import type { FunctionDeclaration } from "@google/genai";
import type { CanonicalItemType, CanonicalRequestType } from "@xbetools/contracts";

export const GEMINI_TOOL_NAMES = {
  listWorkspaceEntries: "list_workspace_entries",
  readFile: "read_file",
  searchFiles: "search_files",
  runCommand: "run_command",
  applyPatch: "apply_patch",
} as const;

export type GeminiToolName = (typeof GEMINI_TOOL_NAMES)[keyof typeof GEMINI_TOOL_NAMES];

export const GEMINI_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: GEMINI_TOOL_NAMES.listWorkspaceEntries,
    description:
      "List files and directories in the workspace. Optionally filter by a search query. " +
      "Returns paths relative to the project root.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional fuzzy search query to filter entries by path or name. " +
            "Leave empty to list top-level entries.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of entries to return. Defaults to 50.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: GEMINI_TOOL_NAMES.readFile,
    description:
      "Read the contents of a file at the given path relative to the project root. " +
      "Returns the file content as text. For large files, use offset and limit to read a portion.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the project root.",
        },
        offset: {
          type: "integer",
          description: "Line number to start reading from (0-based). Defaults to 0.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of lines to read. Defaults to 500.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: GEMINI_TOOL_NAMES.searchFiles,
    description:
      "Search for text content across files in the workspace using a regex pattern. " +
      "Returns matching lines with file paths and line numbers.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for in file contents.",
        },
        glob: {
          type: "string",
          description:
            'Optional glob pattern to filter which files to search (e.g. "*.ts", "src/**/*.tsx").',
        },
        limit: {
          type: "integer",
          description: "Maximum number of matches to return. Defaults to 30.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: GEMINI_TOOL_NAMES.runCommand,
    description:
      "Run a shell command in the project workspace. " +
      "This tool requires user approval before execution. " +
      "Use for build, test, lint, git, and other CLI operations.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The full shell command to execute (e.g. 'npm test', 'git status').",
        },
        timeoutMs: {
          type: "integer",
          description: "Timeout in milliseconds. Defaults to 60000.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: GEMINI_TOOL_NAMES.applyPatch,
    description:
      "Apply a unified diff patch to modify files in the workspace. " +
      "This tool requires user approval before execution. " +
      "The patch should be in standard unified diff format.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description:
            "The unified diff patch content to apply. Use standard unified diff format " +
            "with --- a/path and +++ b/path headers.",
        },
      },
      required: ["patch"],
      additionalProperties: false,
    },
  },
];

export function classifyToolItemType(toolName: string): CanonicalItemType {
  switch (toolName) {
    case GEMINI_TOOL_NAMES.runCommand:
      return "command_execution";
    case GEMINI_TOOL_NAMES.applyPatch:
      return "file_change";
    case GEMINI_TOOL_NAMES.readFile:
    case GEMINI_TOOL_NAMES.searchFiles:
    case GEMINI_TOOL_NAMES.listWorkspaceEntries:
      return "dynamic_tool_call";
    default:
      return "dynamic_tool_call";
  }
}

export function classifyToolRequestType(toolName: string): CanonicalRequestType {
  switch (toolName) {
    case GEMINI_TOOL_NAMES.runCommand:
      return "command_execution_approval";
    case GEMINI_TOOL_NAMES.applyPatch:
      return "apply_patch_approval";
    default:
      return "dynamic_tool_call";
  }
}

export function toolRequiresApproval(toolName: string): boolean {
  return (
    toolName === GEMINI_TOOL_NAMES.runCommand || toolName === GEMINI_TOOL_NAMES.applyPatch
  );
}

export function titleForToolItem(toolName: string): string {
  switch (toolName) {
    case GEMINI_TOOL_NAMES.runCommand:
      return "Command run";
    case GEMINI_TOOL_NAMES.applyPatch:
      return "File change";
    case GEMINI_TOOL_NAMES.readFile:
      return "Read file";
    case GEMINI_TOOL_NAMES.searchFiles:
      return "Search files";
    case GEMINI_TOOL_NAMES.listWorkspaceEntries:
      return "List workspace";
    default:
      return "Tool call";
  }
}

export function summarizeToolCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case GEMINI_TOOL_NAMES.runCommand: {
      const cmd = typeof args.command === "string" ? args.command.trim().slice(0, 400) : "";
      return cmd ? `run_command: ${cmd}` : "run_command";
    }
    case GEMINI_TOOL_NAMES.applyPatch: {
      const patch = typeof args.patch === "string" ? args.patch.trim().slice(0, 200) : "";
      return patch ? `apply_patch: ${patch}` : "apply_patch";
    }
    case GEMINI_TOOL_NAMES.readFile: {
      const p = typeof args.path === "string" ? args.path : "";
      return p ? `read_file: ${p}` : "read_file";
    }
    case GEMINI_TOOL_NAMES.searchFiles: {
      const pat = typeof args.pattern === "string" ? args.pattern : "";
      return pat ? `search_files: ${pat}` : "search_files";
    }
    case GEMINI_TOOL_NAMES.listWorkspaceEntries: {
      const q = typeof args.query === "string" ? args.query : "";
      return q ? `list_workspace_entries: ${q}` : "list_workspace_entries";
    }
    default: {
      const serialized = JSON.stringify(args);
      return serialized.length <= 400
        ? `${toolName}: ${serialized}`
        : `${toolName}: ${serialized.slice(0, 397)}...`;
    }
  }
}
