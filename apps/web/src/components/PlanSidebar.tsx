import { memo, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  LoaderIcon,
  PanelRightCloseIcon,
} from "lucide-react";

import type { ActivePlanState, LatestProposedPlanState } from "~/session-logic";
import { formatTimestamp } from "~/session-logic";
import {
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
} from "~/proposedPlan";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { ScrollArea } from "./ui/scroll-area";
import { toastManager } from "./ui/toast";
import ChatMarkdown from "./ChatMarkdown";

interface PlanSidebarProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  markdownCwd?: string | undefined;
  onClose: () => void;
}

function PlanStepIcon({ status }: { status: "pending" | "inProgress" | "completed" }) {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
        <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
        <LoaderIcon className="size-3 animate-spin text-blue-600 dark:text-blue-400" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted/30">
      <span className="size-1.5 rounded-full bg-muted-foreground-faint" />
    </span>
  );
}

export default memo(function PlanSidebar({
  activePlan,
  activeProposedPlan,
  markdownCwd,
  onClose,
}: PlanSidebarProps) {
  const [proposedExpanded, setProposedExpanded] = useState(false);

  const planMarkdown = activeProposedPlan?.planMarkdown;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;
  const updatedAt = activePlan?.createdAt ?? activeProposedPlan?.updatedAt;
  const hasContent = activePlan || activeProposedPlan;

  const handleCopyPlan = () => {
    if (!planMarkdown) return;
    navigator.clipboard
      .writeText(normalizePlanMarkdownForExport(planMarkdown))
      .then(() => toastManager.add({ type: "info", title: "Plan copied to clipboard" }))
      .catch(() => toastManager.add({ type: "error", title: "Failed to copy plan" }));
  };

  const handleDownloadPlan = () => {
    if (!planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    downloadPlanAsTextFile(filename, normalizePlanMarkdownForExport(planMarkdown));
  };

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border/70">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <span className="text-[10px] font-semibold tracking-widest uppercase">Plan</span>
        </Badge>
        {updatedAt && (
          <span className="truncate text-[11px] text-muted-foreground">
            {formatTimestamp(updatedAt)}
          </span>
        )}
        <span className="flex-1" />
        {planMarkdown && (
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label="Plan actions" />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={handleCopyPlan}>
                <CopyIcon className="size-3.5" />
                Copy to clipboard
              </MenuItem>
              <MenuItem onClick={handleDownloadPlan}>
                <DownloadIcon className="size-3.5" />
                Download as markdown
              </MenuItem>
            </MenuPopup>
          </Menu>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close plan sidebar"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {hasContent ? (
          <div className="space-y-4 px-3 py-3">
            {/* Plan title */}
            {planTitle && (
              <h3 className="text-[13px] font-medium leading-snug">{planTitle}</h3>
            )}

            {/* Explanation */}
            {activePlan?.explanation && (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {activePlan.explanation}
              </p>
            )}

            {/* Steps */}
            {activePlan && activePlan.steps.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
                  Steps
                </span>
                <ul className="space-y-1">
                  {activePlan.steps.map((step) => (
                    <li key={step.step} className="flex items-start gap-2 py-0.5">
                      <PlanStepIcon status={step.status} />
                      <span
                        className={`text-[13px] leading-snug ${
                          step.status === "completed"
                            ? "text-muted-foreground line-through"
                            : step.status === "inProgress"
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                        }`}
                      >
                        {step.step}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Proposed plan markdown */}
            {planMarkdown && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  className="flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground hover:text-foreground"
                  onClick={() => setProposedExpanded((prev) => !prev)}
                >
                  {proposedExpanded ? (
                    <ChevronDownIcon className="size-3" />
                  ) : (
                    <ChevronRightIcon className="size-3" />
                  )}
                  Full plan
                </button>
                {proposedExpanded && (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]">
                    <ChatMarkdown text={planMarkdown} cwd={markdownCwd} />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <p className="text-[13px] font-medium text-muted-foreground">
              No active plan yet.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Plans will appear here when generated.
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
