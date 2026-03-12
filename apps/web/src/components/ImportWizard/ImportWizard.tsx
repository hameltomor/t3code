import { useCallback, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { useImportWizardReducer, type WizardStep } from "./useImportWizardReducer";
import { ProviderSelectStep } from "./steps/ProviderSelectStep";
import { SessionListStep } from "./steps/SessionListStep";
import type { ProjectId } from "@xbetools/contracts";
import { useProject, useStore } from "~/store";
import { getDefaultModel } from "@xbetools/shared/model";

const STEP_LABELS: Record<WizardStep, string> = {
  "provider-select": "Select Provider",
  "session-list": "Browse Sessions",
  preview: "Preview",
  options: "Import Options",
  result: "Result",
};

const STEP_NUMBER: Record<WizardStep, number> = {
  "provider-select": 1,
  "session-list": 2,
  preview: 3,
  options: 4,
  result: 5,
};

interface ImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: ProjectId | null;
}

export function ImportWizard({ isOpen, onClose, projectId }: ImportWizardProps) {
  const project = useProject(projectId);
  const workspaceRoot = project?.cwd ?? null;
  const [state, dispatch] = useImportWizardReducer(getDefaultModel());

  const threads = useStore((s) => s.threads);
  const providerThreadIds = useMemo(
    () =>
      new Set(
        threads
          .map((t) => t.providerThreadId)
          .filter(Boolean) as string[],
      ),
    [threads],
  );

  useEffect(() => {
    if (isOpen) {
      dispatch({ type: "RESET" });
    }
  }, [isOpen, dispatch]);

  const stepNumber = STEP_NUMBER[state.step];

  const handleBack = useCallback(() => {
    dispatch({ type: "GO_BACK" });
  }, [dispatch]);

  const handlePrimaryAction = useCallback(() => {
    switch (state.step) {
      case "provider-select":
        dispatch({ type: "GO_TO_SESSION_LIST" });
        break;
      case "preview":
        dispatch({ type: "GO_TO_OPTIONS" });
        break;
      case "result":
        onClose();
        break;
    }
  }, [state.step, dispatch, onClose]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Import Conversations</DialogTitle>
          <DialogDescription>
            Step {stepNumber} of 5 — {STEP_LABELS[state.step]}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          {state.step === "provider-select" && (
            <ProviderSelectStep
              workspaceRoot={workspaceRoot}
              providerFilter={state.providerFilter}
              dispatch={dispatch}
            />
          )}
          {state.step === "session-list" && (
            <SessionListStep
              workspaceRoot={workspaceRoot}
              providerFilter={state.providerFilter}
              dispatch={dispatch}
              providerThreadIds={providerThreadIds}
            />
          )}
          {state.step === "preview" && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Coming in plan 03-02
            </div>
          )}
          {state.step === "options" && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Coming in plan 03-02
            </div>
          )}
          {state.step === "result" && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Coming in plan 03-02
            </div>
          )}
        </DialogPanel>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={state.step === "provider-select" || state.step === "result"}
            onClick={handleBack}
          >
            Back
          </Button>
          {state.step === "provider-select" && (
            <Button onClick={handlePrimaryAction}>Next</Button>
          )}
          {state.step === "session-list" && (
            <Button disabled>Select a session</Button>
          )}
          {state.step === "preview" && (
            <Button onClick={handlePrimaryAction}>Continue</Button>
          )}
          {state.step === "result" && (
            <Button onClick={handlePrimaryAction}>Done</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
