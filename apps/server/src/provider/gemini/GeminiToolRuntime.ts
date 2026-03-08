/**
 * GeminiToolRuntime - Executes tools requested by Gemini.
 *
 * Each tool function takes standardized args and a cwd, executes the real
 * operation, and returns a structured result suitable for sending back to
 * Gemini as a FunctionResponse.
 *
 * Reuses shared helpers:
 * - `processRunner.ts` for shell command execution
 * - `workspaceEntries.ts` for workspace listing/search
 *
 * @module GeminiToolRuntime
 */
import fs from "node:fs/promises";
import path from "node:path";

import { runProcess } from "../../processRunner.ts";
import { searchWorkspaceEntries } from "../../workspaceEntries.ts";
import { GEMINI_TOOL_NAMES } from "./GeminiToolDefinitions.ts";

const MAX_FILE_READ_LINES = 2000;
const MAX_SEARCH_MATCHES = 100;
const MAX_SEARCH_OUTPUT_CHARS = 50_000;
const MAX_COMMAND_OUTPUT_CHARS = 100_000;

export interface ToolExecutionResult {
  output: Record<string, unknown>;
  error?: string;
}

export async function executeGeminiTool(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case GEMINI_TOOL_NAMES.listWorkspaceEntries:
      return executeListWorkspaceEntries(args, cwd);
    case GEMINI_TOOL_NAMES.readFile:
      return executeReadFile(args, cwd);
    case GEMINI_TOOL_NAMES.searchFiles:
      return executeSearchFiles(args, cwd);
    case GEMINI_TOOL_NAMES.runCommand:
      return executeRunCommand(args, cwd);
    case GEMINI_TOOL_NAMES.applyPatch:
      return executeApplyPatch(args, cwd);
    default:
      return { output: { error: `Unknown tool: ${toolName}` }, error: `Unknown tool: ${toolName}` };
  }
}

async function executeListWorkspaceEntries(
  args: Record<string, unknown>,
  cwd: string,
): Promise<ToolExecutionResult> {
  try {
    const query = typeof args.query === "string" ? args.query : "";
    const limit = typeof args.limit === "number" ? Math.min(args.limit, 200) : 50;
    const result = await searchWorkspaceEntries({ cwd, query, limit });
    return {
      output: {
        entries: result.entries.map((e) => ({
          path: e.path,
          kind: e.kind,
          ...(e.parentPath ? { parentPath: e.parentPath } : {}),
        })),
        truncated: result.truncated,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list workspace entries";
    return { output: { error: message }, error: message };
  }
}

async function executeReadFile(
  args: Record<string, unknown>,
  cwd: string,
): Promise<ToolExecutionResult> {
  try {
    const filePath = typeof args.path === "string" ? args.path : "";
    if (!filePath) {
      return { output: { error: "Missing required parameter: path" }, error: "Missing path" };
    }

    const resolved = path.resolve(cwd, filePath);
    // Security: ensure the file is within the workspace.
    // Append path.sep to avoid prefix confusion (e.g. /tmp/a matching /tmp/ab).
    const cwdPrefix = path.resolve(cwd) + path.sep;
    if (!resolved.startsWith(cwdPrefix) && resolved !== path.resolve(cwd)) {
      return {
        output: { error: "Path is outside the workspace" },
        error: "Path is outside the workspace",
      };
    }

    const content = await fs.readFile(resolved, "utf-8");
    const lines = content.split("\n");
    const offset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;
    const limit = typeof args.limit === "number" ? Math.min(args.limit, MAX_FILE_READ_LINES) : 500;
    const slice = lines.slice(offset, offset + limit);
    const truncated = offset + limit < lines.length;

    return {
      output: {
        path: filePath,
        content: slice.join("\n"),
        totalLines: lines.length,
        offset,
        linesReturned: slice.length,
        truncated,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read file";
    return { output: { error: message }, error: message };
  }
}

async function executeSearchFiles(
  args: Record<string, unknown>,
  cwd: string,
): Promise<ToolExecutionResult> {
  try {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) {
      return { output: { error: "Missing required parameter: pattern" }, error: "Missing pattern" };
    }

    const glob = typeof args.glob === "string" ? args.glob : undefined;
    const limit = typeof args.limit === "number" ? Math.min(args.limit, MAX_SEARCH_MATCHES) : 30;

    // Use ripgrep for content search
    const rgArgs = [
      "--json",
      "--max-count",
      String(limit),
      ...(glob ? ["--glob", glob] : []),
      pattern,
      ".",
    ];

    const result = await runProcess("rg", rgArgs, {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 15_000,
      maxBufferBytes: 2 * 1024 * 1024,
      outputMode: "truncate",
    });

    // Parse ripgrep JSON output
    const matches: Array<{ file: string; line: number; text: string }> = [];
    const lines = result.stdout.split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as {
          type?: string;
          data?: {
            path?: { text?: string };
            line_number?: number;
            lines?: { text?: string };
          };
        };
        if (parsed.type === "match" && parsed.data) {
          matches.push({
            file: parsed.data.path?.text ?? "",
            line: parsed.data.line_number ?? 0,
            text: (parsed.data.lines?.text ?? "").trimEnd(),
          });
        }
      } catch {
        // skip malformed lines
      }
    }

    // Truncate total output size
    let totalChars = 0;
    const truncatedMatches: typeof matches = [];
    for (const m of matches) {
      const entrySize = m.file.length + m.text.length + 20;
      if (totalChars + entrySize > MAX_SEARCH_OUTPUT_CHARS) break;
      totalChars += entrySize;
      truncatedMatches.push(m);
    }

    return {
      output: {
        matches: truncatedMatches,
        matchCount: matches.length,
        truncated: truncatedMatches.length < matches.length,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to search files";
    return { output: { error: message }, error: message };
  }
}

async function executeRunCommand(
  args: Record<string, unknown>,
  cwd: string,
): Promise<ToolExecutionResult> {
  try {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) {
      return {
        output: { error: "Missing required parameter: command" },
        error: "Missing command",
      };
    }

    const timeoutMs =
      typeof args.timeoutMs === "number" ? Math.min(args.timeoutMs, 300_000) : 60_000;

    const result = await runProcess("sh", ["-c", command], {
      cwd,
      allowNonZeroExit: true,
      timeoutMs,
      maxBufferBytes: 4 * 1024 * 1024,
      outputMode: "truncate",
    });

    let stdout = result.stdout;
    let stderr = result.stderr;
    if (stdout.length > MAX_COMMAND_OUTPUT_CHARS) {
      stdout = `${stdout.slice(0, MAX_COMMAND_OUTPUT_CHARS)}... (truncated)`;
    }
    if (stderr.length > MAX_COMMAND_OUTPUT_CHARS) {
      stderr = `${stderr.slice(0, MAX_COMMAND_OUTPUT_CHARS)}... (truncated)`;
    }

    return {
      output: {
        stdout,
        stderr,
        exitCode: result.code,
        timedOut: result.timedOut,
      },
      ...(result.code !== 0 ? { error: `Command exited with code ${result.code}` } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to run command";
    return { output: { error: message }, error: message };
  }
}

async function executeApplyPatch(
  args: Record<string, unknown>,
  cwd: string,
): Promise<ToolExecutionResult> {
  try {
    const patch = typeof args.patch === "string" ? args.patch : "";
    if (!patch) {
      return { output: { error: "Missing required parameter: patch" }, error: "Missing patch" };
    }

    // Apply using `git apply` which handles unified diffs well
    const result = await runProcess("git", ["apply", "--verbose", "-"], {
      cwd,
      stdin: patch,
      allowNonZeroExit: true,
      timeoutMs: 30_000,
    });

    if (result.code !== 0) {
      // Fall back to `patch -p1` if git apply fails
      const patchResult = await runProcess("patch", ["-p1", "--no-backup-if-mismatch"], {
        cwd,
        stdin: patch,
        allowNonZeroExit: true,
        timeoutMs: 30_000,
      });

      if (patchResult.code !== 0) {
        const errorDetail = (patchResult.stderr || patchResult.stdout).trim().slice(0, 500);
        return {
          output: { error: `Patch failed: ${errorDetail}`, applied: false },
          error: `Patch failed: ${errorDetail}`,
        };
      }

      return {
        output: {
          applied: true,
          output: patchResult.stdout.trim().slice(0, 2000),
        },
      };
    }

    return {
      output: {
        applied: true,
        output: (result.stderr || result.stdout).trim().slice(0, 2000),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply patch";
    return { output: { error: message }, error: message };
  }
}
