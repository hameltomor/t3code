import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";
import type { InstallPromptState } from "../hooks/useInstallPrompt";
import { APP_DISPLAY_NAME } from "../branding";
import { cn } from "~/lib/utils";

export function InstallBanner({ install }: { install: InstallPromptState }) {
  if (!install.visible) return null;

  return (
    <div
      className={cn(
        "fixed z-50 bottom-4 left-1/2 -translate-x-1/2 w-full max-w-lg animate-banner-in-bottom",
        "px-4 md:px-0",
      )}
      data-slot="install-banner"
      role="status"
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg/5",
          "md:px-5",
          "dark:shadow-none",
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 md:size-7">
          <DownloadIcon className="size-4 text-primary md:size-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight md:text-xs">
            Install {APP_DISPLAY_NAME}
          </p>
          <p className="mt-0.5 text-xs leading-tight text-muted-foreground md:text-[11px]">
            {install.showIOSInstructions ? (
              <>
                Tap{" "}
                <ShareIcon className="inline size-3 align-text-bottom" />{" "}
                then &ldquo;Add to Home Screen&rdquo;
              </>
            ) : (
              "Add to your home screen for a better experience."
            )}
          </p>
        </div>

        {!install.showIOSInstructions && (
          <button
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-none border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors",
              "md:px-2.5 md:py-1 md:text-xs",
              "hover:bg-primary/90 active:bg-primary/80",
            )}
            onClick={install.promptInstall}
            type="button"
          >
            Install
          </button>
        )}

        <button
          aria-label="Dismiss install prompt"
          className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:size-6"
          onClick={install.dismiss}
          type="button"
        >
          <XIcon className="size-3.5 md:size-3" />
        </button>
      </div>
    </div>
  );
}
