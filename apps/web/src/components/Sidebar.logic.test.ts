import { describe, expect, it } from "vitest";
import { hasUnseenCompletion, resolveThreadStatusPill, type ThreadStatusInput } from "./Sidebar.logic";

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): ThreadStatusInput["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: "completedAt" in (overrides ?? {}) ? (overrides!.startedAt ?? "2026-03-09T10:00:00.000Z") : "2026-03-09T10:00:00.000Z",
    completedAt: "completedAt" in (overrides ?? {}) ? (overrides!.completedAt ?? null) : "2026-03-09T10:05:00.000Z",
  };
}

function makeSession(
  overrides?: Partial<NonNullable<ThreadStatusInput["session"]>>,
): ThreadStatusInput["session"] {
  return {
    provider: "codex" as never,
    status: "ready",
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    orchestrationStatus: "idle" as never,
    ...overrides,
  };
}

const baseThread: ThreadStatusInput = {
  interactionMode: "default",
  latestTurn: null,
  lastVisitedAt: undefined,
  proposedPlans: [],
  session: null,
};

describe("hasUnseenCompletion", () => {
  it("returns false when there is no latest turn", () => {
    expect(hasUnseenCompletion(baseThread)).toBe(false);
  });

  it("returns false when the turn has no completedAt", () => {
    expect(
      hasUnseenCompletion({
        ...baseThread,
        latestTurn: makeLatestTurn({ completedAt: null }),
      }),
    ).toBe(false);
  });

  it("returns true when thread was never visited", () => {
    expect(
      hasUnseenCompletion({
        ...baseThread,
        latestTurn: makeLatestTurn(),
        lastVisitedAt: undefined,
      }),
    ).toBe(true);
  });

  it("returns true when completed after last visit", () => {
    expect(
      hasUnseenCompletion({
        ...baseThread,
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
      }),
    ).toBe(true);
  });

  it("returns false when visited after completion", () => {
    expect(
      hasUnseenCompletion({
        ...baseThread,
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:06:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("resolveThreadStatusPill", () => {
  it("returns null when no status conditions are met", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toBeNull();
  });

  it("shows Pending Approval with highest priority", () => {
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: makeSession({ status: "running" }) },
      hasPendingApprovals: true,
      hasPendingUserInput: true,
    });
    expect(result?.label).toBe("Pending Approval");
    expect(result?.pulse).toBe(false);
  });

  it("shows Awaiting Input above Working", () => {
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: makeSession({ status: "running" }) },
      hasPendingApprovals: false,
      hasPendingUserInput: true,
    });
    expect(result?.label).toBe("Awaiting Input");
    expect(result?.pulse).toBe(false);
  });

  it("shows Working when session is running without blockers", () => {
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: makeSession({ status: "running" }) },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result?.label).toBe("Working");
    expect(result?.pulse).toBe(true);
  });

  it("shows Connecting when session is connecting", () => {
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: makeSession({ status: "connecting" }) },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result?.label).toBe("Connecting");
    expect(result?.pulse).toBe(true);
  });

  it("shows Plan Ready when a settled plan turn has a proposed plan", () => {
    const result = resolveThreadStatusPill({
      thread: {
        ...baseThread,
        interactionMode: "plan",
        latestTurn: makeLatestTurn(),
        session: makeSession(),
        proposedPlans: [
          {
            id: "plan-1" as never,
            turnId: "turn-1" as never,
            planMarkdown: "# My Plan",
            createdAt: "2026-03-09T10:05:00.000Z",
            updatedAt: "2026-03-09T10:05:00.000Z",
          },
        ],
      },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result?.label).toBe("Plan Ready");
    expect(result?.pulse).toBe(false);
  });

  it("does not show Plan Ready when interaction mode is default", () => {
    const result = resolveThreadStatusPill({
      thread: {
        ...baseThread,
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:06:00.000Z",
        session: makeSession(),
        proposedPlans: [
          {
            id: "plan-1" as never,
            turnId: "turn-1" as never,
            planMarkdown: "# My Plan",
            createdAt: "2026-03-09T10:05:00.000Z",
            updatedAt: "2026-03-09T10:05:00.000Z",
          },
        ],
      },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result).toBeNull();
  });

  it("does not show Plan Ready when turn is not settled", () => {
    const result = resolveThreadStatusPill({
      thread: {
        ...baseThread,
        interactionMode: "plan",
        latestTurn: makeLatestTurn({ completedAt: null }),
        session: makeSession({ orchestrationStatus: "running" as never }),
        proposedPlans: [
          {
            id: "plan-1" as never,
            turnId: "turn-1" as never,
            planMarkdown: "# My Plan",
            createdAt: "2026-03-09T10:05:00.000Z",
            updatedAt: "2026-03-09T10:05:00.000Z",
          },
        ],
      },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result).toBeNull();
  });

  it("shows Completed when there is an unseen completion", () => {
    const result = resolveThreadStatusPill({
      thread: {
        ...baseThread,
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
      },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result?.label).toBe("Completed");
    expect(result?.pulse).toBe(false);
  });

  it("prefers Pending Approval over Awaiting Input and Working", () => {
    const result = resolveThreadStatusPill({
      thread: {
        ...baseThread,
        session: makeSession({ status: "running" }),
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
      },
      hasPendingApprovals: true,
      hasPendingUserInput: true,
    });
    expect(result?.label).toBe("Pending Approval");
  });
});
