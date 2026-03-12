import { useCallback, useEffect, useMemo } from "react";
import { LoaderIcon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { toastManager } from "~/components/ui/toast";
import { useImportWizardReducer, type WizardStep } from "./useImportWizardReducer";
import { ProviderSelectStep } from "./steps/ProviderSelectStep";
import { SessionListStep } from "./steps/SessionListStep";
import { PreviewStep } from "./steps/PreviewStep";
import { ImportOptionsStep } from "./steps/ImportOptionsStep";
import { ResultStep } from "./steps/ResultStep";
import type { ProjectId } from "@xbetools/contracts";
import { useProject, useStore } from "~/store";
import { getDefaultModel } from "@xbetools/shared/model";
import {
  historyImportPreviewQueryOptions,
  historyImportExecuteMutationOptions,
} from "~/lib/historyImportReactQuery";

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  // Preview query: enabled when a session is selected
  const previewQuery = useQuery(
    historyImportPreviewQueryOptions(state.selectedSession?.catalogId ?? null),
  );

  // Sync preview data into wizard state
  useEffect(() => {
    if (previewQuery.data && state.selectedSession) {
      dispatch({ type: "SET_PREVIEW", preview: previewQuery.data });
    }
  }, [previewQuery.data, state.selectedSession, dispatch]);

  // Execute mutation
  const executeMutation = useMutation({
    ...historyImportExecuteMutationOptions({ queryClient }),
    onSuccess: (result) => {
      dispatch({ type: "SET_RESULT", result });
      toastManager.add({
        type: "success",
        title: "Conversation imported",
        description: `Imported ${result.messageCount} messages and ${result.activityCount} activities.`,
      });
    },
    onError: (error) => {
      dispatch({ type: "SET_ERROR", error: error.message });
    },
  });

  useEffect(() => {
    if (isOpen) {
      dispatch({ type: "RESET" });
    }
  }, [isOpen, dispatch]);

  const stepNumber = STEP_NUMBER[state.step];

  const handleBack = useCallback(() => {
    dispatch({ type: "GO_BACK" });
  }, [dispatch]);

  const handleNavigateToThread = useCallback(
    (threadId: string) => {
      onClose();
      void navigate({ to: "/$threadId", params: { threadId } });
    },
    [navigate, onClose],
  );

  const handleImport = useCallback(() => {
    if (!state.selectedSession || !projectId) return;
    executeMutation.mutate({
      catalogId: state.selectedSession.catalogId,
      projectId,
      title: state.importOptions.title,
      model: state.importOptions.model,
      runtimeMode: state.importOptions.runtimeMode,
      interactionMode: state.importOptions.interactionMode,
      linkMode: state.importOptions.linkMode,
    });
  }, [state.selectedSession, state.importOptions, projectId, executeMutation]);

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
            <PreviewStep
              preview={state.preview}
              isLoading={previewQuery.isLoading}
              error={previewQuery.error?.message ?? state.error}
            />
          )}
          {state.step === "options" && state.selectedSession && (
            <ImportOptionsStep
              importOptions={state.importOptions}
              selectedSession={state.selectedSession}
              dispatch={dispatch}
            />
          )}
          {state.step === "result" && (
            <ResultStep
              result={state.result}
              error={state.error}
              onNavigateToThread={handleNavigateToThread}
              onClose={onClose}
            />
          )}
        </DialogPanel>

        <DialogFooter>
          {state.step !== "result" && (
            <Button
              variant="ghost"
              disabled={state.step === "provider-select"}
              onClick={handleBack}
            >
              Back
            </Button>
          )}
          {state.step === "provider-select" && (
            <Button onClick={handlePrimaryAction}>Next</Button>
          )}
          {state.step === "session-list" && (
            <Button disabled>Select a session</Button>
          )}
          {state.step === "preview" && (
            <Button
              onClick={handlePrimaryAction}
              disabled={!state.preview}
            >
              Continue
            </Button>
          )}
          {state.step === "options" && (
            <Button
              onClick={handleImport}
              disabled={executeMutation.isPending}
            >
              {executeMutation.isPending ? (
                <>
                  <LoaderIcon className="size-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import"
              )}
            </Button>
          )}
          {state.step === "result" && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              {state.result && (
                <Button onClick={() => handleNavigateToThread(state.result!.threadId)}>
                  Go to Thread
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
