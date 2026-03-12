import { createFileRoute } from "@tanstack/react-router";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { SidebarTrigger, useSidebar } from "../components/ui/sidebar";
import { useStore } from "../store";
import { useImportWizardStore } from "../components/ImportWizard/ImportWizardTrigger";

function ChatIndexRouteView() {
  const { open: sidebarOpen } = useSidebar();
  const projects = useStore((s) => s.projects);
  const firstProject = projects[0] ?? null;

  const handleImportClick = () => {
    if (firstProject) {
      useImportWizardStore.getState().open(firstProject.id);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground-secondary">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">Threads</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className={cn("drag-region flex h-[52px] shrink-0 items-center border-b border-border pr-5", sidebarOpen ? "pl-5" : "pl-[82px]")}>
          <SidebarTrigger className="mr-3 size-7 shrink-0" />
          <span className="text-xs text-muted-foreground-secondary">No active thread</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
          {firstProject && (
            <button
              type="button"
              className="mt-3 text-sm text-primary hover:underline"
              onClick={handleImportClick}
            >
              Import existing chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
