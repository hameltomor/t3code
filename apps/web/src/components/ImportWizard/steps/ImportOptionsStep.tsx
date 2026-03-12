import type {
  HistoryImportConversationSummary,
  HistoryImportLinkMode,
  HistoryImportProvider,
} from "@xbetools/contracts";
import type { ImportOptions, WizardAction } from "../useImportWizardReducer";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";

interface ImportOptionsStepProps {
  importOptions: ImportOptions;
  selectedSession: HistoryImportConversationSummary;
  dispatch: React.Dispatch<WizardAction>;
}

const RUNTIME_MODE_OPTIONS = [
  { value: "full-access", label: "Full Access", description: "Agent has full filesystem and command access" },
  { value: "approval-required", label: "Approval Required", description: "Agent requires approval for file changes and commands" },
] as const;

const INTERACTION_MODE_OPTIONS = [
  { value: "default", label: "Default", description: "Standard interactive conversation mode" },
  { value: "plan", label: "Plan", description: "Agent generates a plan before executing" },
] as const;

const LINK_MODE_OPTIONS: { value: HistoryImportLinkMode; label: string }[] = [
  { value: "native-resume", label: "Native Resume" },
  { value: "transcript-replay", label: "Transcript Replay" },
  { value: "snapshot-only", label: "Snapshot Only" },
];

function getLinkModeDescription(
  linkMode: HistoryImportLinkMode,
  providerName: HistoryImportProvider,
): string {
  if (linkMode === "native-resume") {
    switch (providerName) {
      case "codex":
        return "Continue the original Codex thread through the Codex provider";
      case "claudeCode":
        return "Resume the Claude Code session through the Claude Code provider";
      default:
        return "Resume the original provider session";
    }
  }
  if (linkMode === "transcript-replay") {
    return "Start a new session pre-filled with the imported conversation transcript";
  }
  if (linkMode === "snapshot-only") {
    return "Import as read-only history -- no continuation available";
  }
  return "";
}

export function ImportOptionsStep({ importOptions, selectedSession, dispatch }: ImportOptionsStepProps) {
  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="space-y-1.5">
        <label htmlFor="import-title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="import-title"
          type="text"
          value={importOptions.title}
          onChange={(e) => dispatch({ type: "UPDATE_OPTIONS", options: { title: e.target.value } })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={selectedSession.title}
        />
        <p className="text-xs text-muted-foreground">Name for the imported conversation thread</p>
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <label htmlFor="import-model" className="text-sm font-medium">
          Model
        </label>
        <input
          id="import-model"
          type="text"
          value={importOptions.model}
          onChange={(e) => dispatch({ type: "UPDATE_OPTIONS", options: { model: e.target.value } })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="e.g. o4-mini"
        />
        <p className="text-xs text-muted-foreground">Model to associate with the imported thread</p>
      </div>

      {/* Runtime Mode */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Runtime Mode</label>
        <Select
          value={importOptions.runtimeMode}
          onValueChange={(val) =>
            dispatch({ type: "UPDATE_OPTIONS", options: { runtimeMode: val as ImportOptions["runtimeMode"] } })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {RUNTIME_MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <p className="text-xs text-muted-foreground">
          {RUNTIME_MODE_OPTIONS.find((o) => o.value === importOptions.runtimeMode)?.description}
        </p>
      </div>

      {/* Interaction Mode */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Interaction Mode</label>
        <Select
          value={importOptions.interactionMode}
          onValueChange={(val) =>
            dispatch({ type: "UPDATE_OPTIONS", options: { interactionMode: val as ImportOptions["interactionMode"] } })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {INTERACTION_MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <p className="text-xs text-muted-foreground">
          {INTERACTION_MODE_OPTIONS.find((o) => o.value === importOptions.interactionMode)?.description}
        </p>
      </div>

      {/* Link Mode */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Link Mode</label>
        <Select
          value={importOptions.linkMode}
          onValueChange={(val) =>
            dispatch({ type: "UPDATE_OPTIONS", options: { linkMode: val as HistoryImportLinkMode } })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {LINK_MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <p className="text-xs text-muted-foreground">
          {getLinkModeDescription(importOptions.linkMode, selectedSession.providerName)}
        </p>
      </div>
    </div>
  );
}
