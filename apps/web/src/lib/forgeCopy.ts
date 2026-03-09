/**
 * Provider-aware copy helper for forge terminology (PR vs MR).
 *
 * All user-facing review request labels, toasts, tooltips, and sidebar text
 * must use these helpers so that GitHub shows "PR" and GitLab shows "MR".
 */

export type ForgeProvider = "github" | "gitlab" | "unknown";

/** Short noun: "PR" for GitHub, "MR" for GitLab. */
export function reviewRequestNoun(provider: ForgeProvider): string {
  return provider === "gitlab" ? "MR" : "PR";
}

/** Label for review request actions: "Create PR", "Open MR", etc. */
export function reviewRequestLabel(
  action: "create" | "open" | "created" | "opened" | "creating",
  provider: ForgeProvider,
): string {
  const noun = reviewRequestNoun(provider);
  switch (action) {
    case "create":
      return `Create ${noun}`;
    case "open":
      return `Open ${noun}`;
    case "created":
      return `Created ${noun}`;
    case "opened":
      return `Opened ${noun}`;
    case "creating":
      return `Creating ${noun}...`;
  }
}

/** Compound label: "Push & create PR", "Commit, push & create MR", etc. */
export function compoundActionLabel(
  parts: ("commit" | "push" | "create_rr")[],
  provider: ForgeProvider,
): string {
  const labels = parts.map((p) => {
    if (p === "commit") return "Commit";
    if (p === "push") return "Push";
    return reviewRequestLabel("create", provider).toLowerCase();
  });
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;

  // Capitalize first, join with ", " except last which uses " & "
  const first = labels[0]!;
  const rest = labels.slice(1);
  const last = rest.pop()!;
  const middle = rest.length > 0 ? `, ${rest.join(", ")}` : "";
  return `${first}${middle} & ${last}`;
}

/** Status indicator label: "PR open", "MR merged", etc. */
export function reviewRequestStatusLabel(
  state: "open" | "closed" | "merged",
  provider: ForgeProvider,
): string {
  const noun = reviewRequestNoun(provider);
  return `${noun} ${state}`;
}
