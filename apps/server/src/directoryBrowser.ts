import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DirectoryListInput, DirectoryListResult } from "@xbetools/contracts";

/** Maximum entries returned per listing to bound payload size. */
const MAX_ENTRIES = 1_000;

/** Concurrency limit for parallel stat calls. */
const STAT_CONCURRENCY = 32;

/** Names always excluded regardless of `showHidden`. */
const ALWAYS_SKIP = new Set(["node_modules", ".git"]);

/**
 * Returns the set of filesystem roots that the directory browser is allowed
 * to enumerate.
 *
 * On Windows this is the home directory plus detected drive letters, providing
 * meaningful access restriction. On POSIX this includes `/`, which means the
 * browser can enumerate any readable path — the OS permission model is the
 * real access boundary. This is intentional for a local-first tool where the
 * server runs on the user's own machine.
 *
 * To restrict further, add explicit allowed roots here.
 */
/** @internal Exported for testing. */
export async function getAllowedRoots(): Promise<string[]> {
  const roots: string[] = [];

  // Always allow home directory
  const home = os.homedir();
  if (home) roots.push(path.resolve(home));

  if (process.platform === "win32") {
    // On Windows, enumerate common drive letters
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const checks = await Promise.allSettled(
      [...letters].map(async (letter) => {
        const root = `${letter}:\\`;
        await fs.access(root);
        return root;
      }),
    );
    for (const result of checks) {
      if (result.status === "fulfilled") roots.push(result.value);
    }
  } else {
    // On POSIX, allow filesystem root — the folder picker UI naturally
    // restricts navigation. Sensitive directories are permission-guarded
    // by the OS.
    roots.push("/");
  }

  return roots;
}

/**
 * Validate that `target` is inside (or equal to) at least one allowed root.
 * Normalises both sides to resolved absolute paths for comparison.
 */
/** @internal Exported for testing. */
export function isUnderAllowedRoot(target: string, allowedRoots: readonly string[]): boolean {
  const resolved = path.resolve(target);
  for (const root of allowedRoots) {
    const resolvedRoot = path.resolve(root);
    if (resolved === resolvedRoot) return true;
    // Ensure the prefix includes a trailing separator to avoid partial matches
    // (e.g. /home/a matching /home/ab). For filesystem roots like "/" the
    // trailing separator is already present.
    const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (resolved.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Run `fn` across `items` with at most `concurrency` in-flight at a time.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

/**
 * List directory contents for the folder-picker modal.
 * Returns directories first, then files, both sorted alphabetically.
 *
 * Access control: on Windows, rejects paths outside detected drive roots and
 * home directory. On POSIX, allows any readable path (OS permissions are the
 * boundary). Stats entries in parallel with a concurrency limit and caps the
 * returned entry count.
 */
export async function listDirectory(input: DirectoryListInput): Promise<DirectoryListResult> {
  const resolvedPath = path.resolve(input.path);

  // ── Security: validate path is within allowed roots ──
  const allowedRoots = await getAllowedRoots();
  if (!isUnderAllowedRoot(resolvedPath, allowedRoots)) {
    throw new Error("Access denied: path is outside allowed filesystem roots.");
  }

  const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });

  // Filter entries
  const filtered = dirents.filter((dirent) => {
    if (ALWAYS_SKIP.has(dirent.name)) return false;
    if (!input.showHidden && dirent.name.startsWith(".")) return false;
    return true;
  });

  // Sort: directories first, then files, each group alphabetical
  filtered.sort((a, b) => {
    const aIsDir = a.isDirectory();
    const bIsDir = b.isDirectory();
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Cap entry count to avoid unbounded payloads
  const capped = filtered.slice(0, MAX_ENTRIES);

  // Stat entries in parallel
  const entries = await mapWithConcurrency(capped, STAT_CONCURRENCY, async (dirent) => {
    const kind = dirent.isDirectory() ? ("directory" as const) : ("file" as const);
    const fullPath = path.join(resolvedPath, dirent.name);

    let size: number | undefined;
    let modifiedAt: string | undefined;
    try {
      const stat = await fs.stat(fullPath);
      size = stat.size;
      modifiedAt = stat.mtime.toISOString();
    } catch {
      // stat may fail for broken symlinks — skip metadata
    }

    return {
      name: dirent.name,
      path: fullPath,
      kind,
      size,
      modifiedAt,
    };
  });

  // Compute parent path using platform-aware logic
  const isRoot =
    process.platform === "win32"
      ? /^[A-Za-z]:\\?$/.test(resolvedPath)
      : resolvedPath === "/";
  const parentPath = isRoot ? null : path.dirname(resolvedPath);

  return {
    entries,
    currentPath: resolvedPath,
    parentPath,
  };
}
