export type ForgeProvider = "github" | "gitlab";

/**
 * Extract the hostname from a git remote URL.
 * Handles SSH (`git@host:group/repo.git`) and HTTPS (`https://host/group/repo.git`) formats.
 */
export function extractHostFromRemoteUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  // SSH format: git@gitlab.company.com:group/repo.git
  const sshMatch = trimmed.match(/^[\w.-]+@([\w.-]+):/);
  if (sshMatch?.[1]) return sshMatch[1].toLowerCase();

  // HTTPS / HTTP format
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Detect forge provider from a git remote URL by parsing the hostname.
 * Returns null for unknown hosts — callers must handle that case explicitly.
 */
export function detectForgeProviderFromRemoteUrl(remoteUrl: string): ForgeProvider | null {
  const host = extractHostFromRemoteUrl(remoteUrl);
  if (!host) return null;

  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "gitlab.com" || host.includes("gitlab")) return "gitlab";

  return null;
}

/**
 * Sanitize an arbitrary string into a valid, lowercase git branch fragment.
 * Strips quotes, collapses separators, limits to 64 chars.
 */
export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const branchFragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return branchFragment.length > 0 ? branchFragment : "update";
}

/**
 * Sanitize a string into a `feature/…` branch name.
 * Preserves an existing `feature/` prefix or slash-separated namespace.
 */
export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw);
  if (sanitized.includes("/")) {
    return sanitized.startsWith("feature/") ? sanitized : `feature/${sanitized}`;
  }
  return `feature/${sanitized}`;
}

const AUTO_FEATURE_BRANCH_FALLBACK = "feature/update";

/**
 * Resolve a unique `feature/…` branch name that doesn't collide with
 * any existing branch. Appends a numeric suffix when needed.
 */
export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK,
  );
  const existingNames = new Set(existingBranchNames.map((branch) => branch.toLowerCase()));

  if (!existingNames.has(resolvedBase)) {
    return resolvedBase;
  }

  let suffix = 2;
  while (existingNames.has(`${resolvedBase}-${suffix}`)) {
    suffix += 1;
  }

  return `${resolvedBase}-${suffix}`;
}
