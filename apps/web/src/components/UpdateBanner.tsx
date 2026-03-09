import { DownloadIcon, RefreshCwIcon, RocketIcon, XIcon } from "lucide-react";
import { type AppUpdateInfo, type AppUpdateStatus } from "../hooks/useAppUpdate";
import { cn } from "~/lib/utils";

const STATUS_CONFIG: Record<
  Exclude<AppUpdateStatus, "idle">,
  { icon: typeof RefreshCwIcon; label: string; buttonLabel: string }
> = {
  available: {
    icon: DownloadIcon,
    label: "Update available",
    buttonLabel: "Update now",
  },
  downloading: {
    icon: DownloadIcon,
    label: "Downloading update",
    buttonLabel: "Downloading…",
  },
  ready: {
    icon: RocketIcon,
    label: "Update ready",
    buttonLabel: "Restart now",
  },
  error: {
    icon: RefreshCwIcon,
    label: "Update failed",
    buttonLabel: "Retry",
  },
};

export function UpdateBanner({ update }: { update: AppUpdateInfo }) {
  if (!update.visible || update.status === "idle") return null;

  const config = STATUS_CONFIG[update.status];
  const Icon = config.icon;
  const isDownloading = update.status === "downloading";
  const description =
    update.status === "downloading" && update.progress != null
      ? `Downloading… ${Math.floor(update.progress)}%`
      : update.version
        ? `Version ${update.version} is ready.`
        : "A new version is available.";

  return (
    <div
      className={cn(
        // Fixed top banner below the header, centered with max width.
        "fixed z-50 top-3 left-1/2 -translate-x-1/2 w-full max-w-lg animate-banner-in-top",
        // Horizontal padding so it doesn't touch edges on mobile.
        "px-4 md:px-0",
      )}
      data-slot="update-banner"
      role="status"
    >
      <div
        className={cn(
          // Card styling following XBE styleguide — centered floating card.
          "flex items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-popover-foreground shadow-lg/5",
          "md:px-5",
          // Dark mode: border contrast instead of shadow.
          "dark:shadow-none",
        )}
      >
        {/* Icon */}
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 md:size-7">
          <Icon
            className={cn(
              "size-4 text-primary md:size-3.5",
              isDownloading && "animate-pulse",
            )}
          />
        </div>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight md:text-xs">{config.label}</p>
          <p className="mt-0.5 text-xs leading-tight text-muted-foreground md:text-[11px]">
            {description}
          </p>
        </div>

        {/* Progress bar (downloading only) */}
        {isDownloading && update.progress != null && (
          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${update.progress}%` }}
            />
          </div>
        )}

        {/* Action button — sharp corners per XBE styleguide */}
        <button
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-none border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors",
            "md:px-2.5 md:py-1 md:text-xs",
            isDownloading
              ? "pointer-events-none opacity-60"
              : "hover:bg-primary/90 active:bg-primary/80",
          )}
          disabled={isDownloading}
          onClick={update.action}
          type="button"
        >
          {config.buttonLabel}
        </button>

        {/* Dismiss button */}
        {!isDownloading && (
          <button
            aria-label="Dismiss update notification"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:size-6"
            onClick={update.dismiss}
            type="button"
          >
            <XIcon className="size-3.5 md:size-3" />
          </button>
        )}
      </div>

    </div>
  );
}
