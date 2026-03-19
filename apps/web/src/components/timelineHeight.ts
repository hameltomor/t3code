/**
 * Shared padding added by the `pb-4` wrapper in `renderRowContent` (ChatView).
 * Every timeline row is wrapped in `<div className="pb-4">`, adding 16px of
 * bottom-padding that must be included in height estimates.
 */
export const ROW_WRAPPER_PADDING_PX = 16;

const ASSISTANT_CHARS_PER_LINE_FALLBACK = 72;
const USER_CHARS_PER_LINE_FALLBACK = 54;

// Assistant messages render as ChatMarkdown (proportional font, ~14px body text).
const ASSISTANT_LINE_HEIGHT_PX = 22;
// User messages render as monospace <pre> with `text-base leading-relaxed`
// (16px × 1.625 = 26px). The `md:text-sm` class on the <pre> does NOT take
// effect because the element is inside a width-constrained bubble; measured in
// production at 26px across all viewport widths.
const USER_LINE_HEIGHT_PX = 26;

// Base heights include ROW_WRAPPER_PADDING_PX.
const ASSISTANT_BASE_HEIGHT_PX = 78 + ROW_WRAPPER_PADDING_PX;
const USER_BASE_HEIGHT_PX = 96 + ROW_WRAPPER_PADDING_PX;

const ATTACHMENTS_PER_ROW = 2;
// Attachment thumbnails render with `max-h-[220px]` plus ~8px row gap.
const USER_ATTACHMENT_ROW_HEIGHT_PX = 228;
const USER_BUBBLE_WIDTH_RATIO = 0.8;
// px-4 (16px each side = 32px) + border (1px each side = 2px).
const USER_BUBBLE_HORIZONTAL_PADDING_PX = 34;
const ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX = 8;
// Monospace character width at 16px font-size (measured via canvas in production).
const USER_MONO_AVG_CHAR_WIDTH_PX = 9.6;
const ASSISTANT_AVG_CHAR_WIDTH_PX = 7.2;
const MIN_USER_CHARS_PER_LINE = 4;
const MIN_ASSISTANT_CHARS_PER_LINE = 20;

interface TimelineMessageHeightInput {
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ReadonlyArray<{ id: string }>;
}

interface TimelineHeightEstimateLayout {
  timelineWidthPx: number | null;
}

function estimateWrappedLineCount(text: string, charsPerLine: number): number {
  if (text.length === 0) return 1;

  // Avoid allocating via split for long logs; iterate once and count wrapped lines.
  let lines = 0;
  let currentLineLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
      currentLineLength = 0;
      continue;
    }
    currentLineLength += 1;
  }

  lines += Math.max(1, Math.ceil(currentLineLength / charsPerLine));
  return lines;
}

function isFinitePositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function estimateCharsPerLineForUser(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return USER_CHARS_PER_LINE_FALLBACK;
  const bubbleWidthPx = timelineWidthPx * USER_BUBBLE_WIDTH_RATIO;
  const textWidthPx = Math.max(bubbleWidthPx - USER_BUBBLE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(MIN_USER_CHARS_PER_LINE, Math.floor(textWidthPx / USER_MONO_AVG_CHAR_WIDTH_PX));
}

function estimateCharsPerLineForAssistant(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return ASSISTANT_CHARS_PER_LINE_FALLBACK;
  const textWidthPx = Math.max(timelineWidthPx - ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX, 0);
  return Math.max(
    MIN_ASSISTANT_CHARS_PER_LINE,
    Math.floor(textWidthPx / ASSISTANT_AVG_CHAR_WIDTH_PX),
  );
}

export function estimateTimelineMessageHeight(
  message: TimelineMessageHeightInput,
  layout: TimelineHeightEstimateLayout = { timelineWidthPx: null },
): number {
  if (message.role === "assistant") {
    const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
    const estimatedLines = estimateWrappedLineCount(message.text, charsPerLine);
    return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * ASSISTANT_LINE_HEIGHT_PX;
  }

  if (message.role === "user") {
    const charsPerLine = estimateCharsPerLineForUser(layout.timelineWidthPx);
    const estimatedLines = estimateWrappedLineCount(message.text, charsPerLine);
    const attachmentCount = message.attachments?.length ?? 0;
    const attachmentRows = Math.ceil(attachmentCount / ATTACHMENTS_PER_ROW);
    const attachmentHeight = attachmentRows * USER_ATTACHMENT_ROW_HEIGHT_PX;
    return USER_BASE_HEIGHT_PX + estimatedLines * USER_LINE_HEIGHT_PX + attachmentHeight;
  }

  // `system` messages are not rendered in the chat timeline, but keep a stable
  // explicit branch in case they are present in timeline data.
  const charsPerLine = estimateCharsPerLineForAssistant(layout.timelineWidthPx);
  const estimatedLines = estimateWrappedLineCount(message.text, charsPerLine);
  return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * ASSISTANT_LINE_HEIGHT_PX;
}
