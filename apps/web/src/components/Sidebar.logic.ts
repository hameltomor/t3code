import type { OrchestrationLatestTurn, ProviderInteractionMode } from "@xbetools/contracts";
import type { ProposedPlan, ThreadSession } from "../types";
import { findLatestProposedPlan, isLatestTurnSettled } from "../session-logic";

// ── Thread recency ──────────────────────────────────────────────────
//
// Canonical comparator for sidebar/search thread ordering.
// Primary: updatedAt DESC, Secondary: createdAt DESC, Tertiary: id DESC.

/** Minimal shape needed by the recency comparator. */
export interface ThreadRecencyFields {
  id: string;
  updatedAt: string;
  createdAt: string;
}

/** Compare two threads by recency (most recent first). */
export function compareThreadsByRecency(a: ThreadRecencyFields, b: ThreadRecencyFields): number {
  const byUpdated = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (byUpdated !== 0) return byUpdated;
  const byCreated = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (byCreated !== 0) return byCreated;
  return b.id.localeCompare(a.id);
}

/** Return the updatedAt timestamp in ms for a thread. */
export function getThreadRecencyMs(thread: ThreadRecencyFields): number {
  return new Date(thread.updatedAt).getTime();
}

export const THREAD_SELECTION_SAFE_SELECTOR =
  "[data-thread-item], [data-thread-selection-safe]";

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

export type ThreadStatusInput = {
  interactionMode: ProviderInteractionMode;
  latestTurn: OrchestrationLatestTurn | null;
  lastVisitedAt?: string | undefined;
  proposedPlans: ReadonlyArray<ProposedPlan>;
  session: ThreadSession | null;
  /** ISO timestamp of the most recent user message, if any. */
  latestUserMessageAt?: string | undefined;
};

/** Max age (ms) for the pre-session "Working" pill before we stop showing it. */
const PENDING_START_MAX_AGE_MS = 120_000;

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

const WORKING_PILL: ThreadStatusPill = {
  label: "Working",
  colorClass: "text-sky-600 dark:text-sky-300/80",
  dotClass: "bg-sky-500 dark:bg-sky-300/80",
  pulse: true,
};

export function resolveThreadStatusPill(
  input: {
    thread: ThreadStatusInput;
    hasPendingApprovals: boolean;
    hasPendingUserInput: boolean;
  },
  now?: number,
): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  // Session is actively running or bootstrapping — show "Working" for both.
  if (thread.session?.status === "running" || thread.session?.status === "connecting") {
    return WORKING_PILL;
  }

  // Pre-session: user sent a message but the provider session hasn't been bound yet.
  // Time-bound to avoid getting stuck on abandoned / failed thread starts.
  if (
    thread.session === null &&
    thread.latestUserMessageAt &&
    !thread.latestTurn?.completedAt
  ) {
    const messageAge = (now ?? Date.now()) - Date.parse(thread.latestUserMessageAt);
    if (messageAge < PENDING_START_MAX_AGE_MS) {
      return WORKING_PILL;
    }
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null) !== null;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}
