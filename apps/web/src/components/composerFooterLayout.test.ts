import { describe, expect, it } from "vitest";
import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  shouldUseCompactComposerFooter,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerFooter", () => {
  it("returns false when width is null", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("returns true when width is below standard breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("returns false when width is at standard breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
  });

  it("returns false when width is above standard breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 100)).toBe(false);
  });

  it("uses wider breakpoint with hasWideActions", () => {
    const between =
      COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX +
      Math.floor(
        (COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX -
          COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX) /
          2,
      );
    expect(shouldUseCompactComposerFooter(between)).toBe(false);
    expect(shouldUseCompactComposerFooter(between, { hasWideActions: true })).toBe(true);
  });

  it("returns false at wide actions breakpoint", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});
