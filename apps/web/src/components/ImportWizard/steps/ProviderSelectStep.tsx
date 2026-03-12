import { FolderIcon } from "lucide-react";
import type { HistoryImportProvider } from "@xbetools/contracts";
import { ToggleGroup, Toggle } from "~/components/ui/toggle-group";
import type { WizardAction } from "../useImportWizardReducer";

interface ProviderSelectStepProps {
  workspaceRoot: string | null;
  providerFilter: HistoryImportProvider | null;
  dispatch: React.Dispatch<WizardAction>;
}

const PROVIDER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "codex", label: "Codex" },
  { value: "claudeCode", label: "Claude Code" },
] as const;

export function ProviderSelectStep({
  workspaceRoot,
  providerFilter,
  dispatch,
}: ProviderSelectStepProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-md border p-3">
        <FolderIcon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Workspace Root</p>
          <p className="truncate text-xs text-muted-foreground">
            {workspaceRoot ?? "No workspace"}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Provider Filter</p>
        <ToggleGroup
          value={[providerFilter ?? "all"]}
          onValueChange={(newValue: (string | number)[]) => {
            const selected = newValue[0] as string | undefined;
            if (!selected) return;
            dispatch({
              type: "SET_PROVIDER_FILTER",
              filter: selected === "all" ? null : (selected as HistoryImportProvider),
            });
          }}
        >
          {PROVIDER_OPTIONS.map((option) => (
            <Toggle key={option.value} value={option.value} variant="outline" size="sm">
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>

      <p className="text-xs text-muted-foreground">
        Discover importable conversations from your provider history. Sessions from the selected
        workspace root will be scanned.
      </p>
    </div>
  );
}
