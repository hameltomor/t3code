import { describe, expect, it } from "vitest";

import { estimateTimelineMessageHeight } from "./timelineHeight";

describe("estimateTimelineMessageHeight", () => {
  it("uses assistant sizing rules for assistant messages", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "assistant",
        text: "a".repeat(144),
      }),
    ).toBe(138);
  });

  it("uses assistant sizing rules for system messages", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "system",
        text: "a".repeat(144),
      }),
    ).toBe(138);
  });

  it("adds one attachment row for one or two user attachments", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [{ id: "1" }],
      }),
    ).toBe(362);

    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [{ id: "1" }, { id: "2" }],
      }),
    ).toBe(362);
  });

  it("adds a second attachment row for three or four user attachments", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [{ id: "1" }, { id: "2" }, { id: "3" }],
      }),
    ).toBe(590);

    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "hello",
        attachments: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }],
      }),
    ).toBe(590);
  });

  it("does not cap long user message estimates", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "a".repeat(56 * 120),
      }),
    ).toBe(2752);
  });

  it("counts explicit newlines for user message estimates", () => {
    expect(
      estimateTimelineMessageHeight({
        role: "user",
        text: "first\nsecond\nthird",
      }),
    ).toBe(178);
  });

  it("uses narrower width to increase user line wrapping", () => {
    const message = {
      role: "user" as const,
      text: "a".repeat(52),
    };

    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 320 })).toBe(156);
    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 768 })).toBe(134);
  });

  it("does not clamp user wrapping too aggressively on very narrow layouts", () => {
    const message = {
      role: "user" as const,
      text: "a".repeat(20),
    };

    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 100 })).toBe(200);
    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 320 })).toBe(134);
  });

  it("uses narrower width to increase assistant line wrapping", () => {
    const message = {
      role: "assistant" as const,
      text: "a".repeat(200),
    };

    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 320 })).toBe(204);
    expect(estimateTimelineMessageHeight(message, { timelineWidthPx: 768 })).toBe(138);
  });
});
