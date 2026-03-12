import { create } from "zustand";
import { DownloadIcon } from "lucide-react";
import type { ProjectId } from "@xbetools/contracts";
import { Button } from "~/components/ui/button";

interface ImportWizardStore {
  isOpen: boolean;
  projectId: ProjectId | null;
  open: (projectId: ProjectId) => void;
  close: () => void;
}

export const useImportWizardStore = create<ImportWizardStore>((set) => ({
  isOpen: false,
  projectId: null,
  open: (projectId) => set({ isOpen: true, projectId }),
  close: () => set({ isOpen: false, projectId: null }),
}));

interface ImportWizardTriggerProps {
  projectId: ProjectId;
  variant?: "default" | "ghost" | "outline";
  className?: string;
}

export function ImportWizardTrigger({
  projectId,
  variant = "ghost",
  className,
}: ImportWizardTriggerProps) {
  return (
    <Button
      variant={variant}
      className={className}
      onClick={() => useImportWizardStore.getState().open(projectId)}
    >
      <DownloadIcon className="mr-2 size-4" />
      Import Conversations
    </Button>
  );
}
