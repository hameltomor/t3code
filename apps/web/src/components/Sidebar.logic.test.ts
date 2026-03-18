import { describe, expect, it } from "vitest";
import {
  compareThreadsByRecency,
  getThreadRecencyMs,
  hasUnseenCompletion,
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
  type ThreadRecencyFields,
  type ThreadStatusInput,
} from "./Sidebar.logic";

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

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
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

  it("shows Working when session is connecting (collapsed into Working)", () => {
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: makeSession({ status: "connecting" }) },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result?.label).toBe("Working");
    expect(result?.pulse).toBe(true);
  });

  it("shows Working when session is null but a recent user message exists", () => {
    const recentTimestamp = new Date(Date.now() - 5_000).toISOString();
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: null, latestUserMessageAt: recentTimestamp },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result?.label).toBe("Working");
    expect(result?.pulse).toBe(true);
  });

  it("does not show Working for pre-session thread when message is too old", () => {
    const oldTimestamp = new Date(Date.now() - 300_000).toISOString();
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: null, latestUserMessageAt: oldTimestamp },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result).toBeNull();
  });

  it("does not show Working when session is null and no user messages exist", () => {
    const result = resolveThreadStatusPill({
      thread: { ...baseThread, session: null },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
    expect(result).toBeNull();
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

function makeRecencyThread(overrides: Partial<ThreadRecencyFields> = {}): ThreadRecencyFields {
  return {
    id: "thread-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("compareThreadsByRecency", () => {
  it("sorts by updatedAt descending (most recent first)", () => {
    const older = makeRecencyThread({
      id: "thread-old",
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
    const newer = makeRecencyThread({
      id: "thread-new",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    });

    const sorted = [older, newer].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("thread-new");
    expect(sorted[1]!.id).toBe("thread-old");
  });

  it("thread with older createdAt but newer updatedAt sorts above a newer-created inactive thread", () => {
    const oldCreatedRecentlyActive = makeRecencyThread({
      id: "thread-active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-15T12:00:00.000Z",
    });
    const newCreatedInactive = makeRecencyThread({
      id: "thread-inactive",
      createdAt: "2026-03-14T00:00:00.000Z",
      updatedAt: "2026-03-14T00:00:00.000Z",
    });

    const sorted = [newCreatedInactive, oldCreatedRecentlyActive].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("thread-active");
    expect(sorted[1]!.id).toBe("thread-inactive");
  });

  it("falls back to createdAt when updatedAt is equal", () => {
    const a = makeRecencyThread({
      id: "thread-a",
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
    const b = makeRecencyThread({
      id: "thread-b",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });

    const sorted = [a, b].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("thread-b");
  });

  it("falls back to id when both timestamps are equal", () => {
    const a = makeRecencyThread({ id: "aaa" });
    const b = makeRecencyThread({ id: "zzz" });

    const sorted = [a, b].toSorted(compareThreadsByRecency);
    expect(sorted[0]!.id).toBe("zzz");
  });
});

describe("getThreadRecencyMs", () => {
  it("returns the updatedAt timestamp in milliseconds", () => {
    const thread: ThreadRecencyFields = {
      id: "t1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-15T12:00:00.000Z",
    };
    expect(getThreadRecencyMs(thread)).toBe(new Date("2026-03-15T12:00:00.000Z").getTime());
  });
});
