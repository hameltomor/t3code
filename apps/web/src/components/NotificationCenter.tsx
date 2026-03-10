import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { BellIcon, BellRingIcon, CheckCheckIcon, InboxIcon, ShareIcon } from "lucide-react";
import type { AppNotification } from "@xbetools/contracts";

import { readNativeApi } from "../nativeApi";
import {
  clearStaleNativeNotifications,
  getDeniedPermissionInstructions,
  getNotificationPermission,
  isIOSSafariBrowser,
  installPushSubscriptionChangeListener,
  playNotificationSound,
  requestNotificationPermission,
  setTitleBadge,
  showNativeNotification,
  subscribeToPush,
  supportsNotifications,
  supportsPush,
  updateAppBadge,
} from "../lib/notifications";
import { getAppVisibility, onAppBecameActive } from "../hooks/useAppVisibility";
import { useAppSettings } from "../appSettings";
import { cn } from "~/lib/utils";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ScrollArea } from "~/components/ui/scroll-area";

function formatNotificationTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  "turn-completed": "Completed",
  "approval-needed": "Approval",
  "input-needed": "Input",
};

function NotificationItem({
  notification,
  onNavigate,
}: {
  notification: AppNotification;
  onNavigate: (threadId: string, notificationId: string) => void;
}) {
  const isUnread = notification.readAt === null;

  return (
    <button
      type="button"
      className={cn(
        "flex w-full cursor-pointer gap-3 md:gap-3 rounded-lg px-4 md:px-3 py-4 md:py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted/70",
        isUnread && "bg-muted/30",
      )}
      onClick={() => onNavigate(notification.threadId, notification.notificationId)}
    >
      <div className="mt-1 md:mt-0.5 flex-shrink-0">
        <div
          className={cn(
            "size-2.5 md:size-2 rounded-full",
            isUnread ? "bg-primary" : "bg-transparent",
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-sm md:text-xs font-medium", isUnread ? "text-primary" : "text-muted-foreground")}>
            {NOTIFICATION_KIND_LABELS[notification.kind] ?? notification.kind}
          </span>
          <span className="text-sm md:text-xs text-muted-foreground flex-shrink-0">
            {formatNotificationTime(notification.createdAt)}
          </span>
        </div>
        <p className={cn("text-base md:text-sm mt-1 md:mt-0.5 line-clamp-2", isUnread ? "text-foreground" : "text-muted-foreground")}>
          {notification.body}
        </p>
      </div>
    </button>
  );
}

function markNotificationsReadForThread(
  threadId: string,
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>,
  setUnreadCount: React.Dispatch<React.SetStateAction<number>>,
): void {
  const now = new Date().toISOString();
  let markedCount = 0;
  setNotifications((prev) =>
    prev.map((n) => {
      if (n.threadId === threadId && n.readAt === null) {
        markedCount++;
        return { ...n, readAt: now };
      }
      return n;
    }),
  );
  if (markedCount > 0) {
    setUnreadCount((prev) => Math.max(0, prev - markedCount));
  }
}

// ---------------------------------------------------------------------------
// Permission CTA banner shown inside the notification sheet
// ---------------------------------------------------------------------------

function NotificationPermissionBanner({
  onPermissionChange,
}: {
  onPermissionChange: () => void;
}) {
  const { settings, updateSettings } = useAppSettings();
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    getNotificationPermission(),
  );
  const [requesting, setRequesting] = useState(false);

  // Re-check permission whenever the sheet opens (user may have changed browser settings)
  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  // Already enabled — nothing to show
  if (settings.enableNotifications && permission === "granted") {
    return null;
  }

  // iOS Safari in-browser — push not supported without installing PWA
  if (isIOSSafariBrowser) {
    return (
      <div className="mx-2 mt-2 rounded-lg border border-border bg-muted/50 p-3 md:p-2.5">
        <div className="flex items-start gap-2.5">
          <ShareIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm md:text-xs font-medium text-foreground">
              Install for notifications
            </p>
            <p className="mt-0.5 text-sm md:text-xs text-muted-foreground">
              Tap{" "}
              <span className="inline-flex items-baseline gap-0.5">
                <ShareIcon className="inline size-3" />
                <span>Share</span>
              </span>
              {" \u2192 "}
              <span className="font-medium">&ldquo;Add to Home Screen&rdquo;</span> to enable push
              notifications on iOS.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Browser doesn't support notifications at all
  if (!supportsNotifications()) {
    return null;
  }

  // Permission was denied — show platform-specific recovery instructions
  if (permission === "denied") {
    return (
      <div className="mx-2 mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 md:p-2.5">
        <p className="text-sm md:text-xs font-medium text-destructive">Notifications blocked</p>
        <p className="mt-0.5 text-sm md:text-xs text-muted-foreground">
          {getDeniedPermissionInstructions()}
        </p>
        <button
          type="button"
          className="mt-1.5 text-sm md:text-xs font-medium text-primary hover:underline"
          onClick={() => setPermission(getNotificationPermission())}
        >
          Re-check permission
        </button>
      </div>
    );
  }

  // Permission is "default" (never asked) or notifications are disabled in app settings
  const handleEnable = async () => {
    setRequesting(true);
    try {
      const result = await requestNotificationPermission();
      setPermission(result);
      if (result === "granted") {
        updateSettings({ enableNotifications: true });
        const api = readNativeApi();
        if (api && supportsPush()) {
          await subscribeToPush(api.notifications);
        }
        onPermissionChange();
      }
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="mx-2 mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3 md:p-2.5">
      <div className="flex items-start gap-2.5">
        <BellRingIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm md:text-xs font-medium text-foreground">
            Stay in the loop
          </p>
          <p className="mt-0.5 text-sm md:text-xs text-muted-foreground">
            Get notified when tasks complete, need approval, or require your input.
          </p>
          <Button
            size="sm"
            className="mt-2 h-8 md:h-7 text-sm md:text-xs"
            disabled={requesting}
            onClick={() => void handleEnable()}
          >
            {requesting ? "Requesting..." : "Enable notifications"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const hasLoadedRef = useRef(false);

  const activeThreadId = useParams({
    strict: false,
    select: (params) => params.threadId ?? null,
  });
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  const fetchNotifications = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    try {
      const result = await api.notifications.list(50, 0);
      setNotifications(result.notifications as AppNotification[]);
      setUnreadCount(result.totalUnread);
      // Re-apply active thread read marking in case markReadByThread hasn't landed yet
      const currentThreadId = activeThreadIdRef.current;
      if (currentThreadId) {
        markNotificationsReadForThread(currentThreadId, setNotifications, setUnreadCount);
      }
    } catch {
      // Server not ready yet
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;
    try {
      const result = await api.notifications.unreadCount();
      setUnreadCount(result.count);
    } catch {
      // Server not ready yet
    }
  }, []);

  // Subscribe to live notification events
  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;

    // Initial fetch
    void fetchUnreadCount();

    const unsub = api.notifications.onNotification((notification) => {
      const isActiveThread = activeThreadIdRef.current === notification.threadId;
      const visibility = getAppVisibility();

      if (isActiveThread && visibility === "active") {
        // User is actively viewing this thread — mark as read, no alerts
        const now = new Date().toISOString();
        const readNotification = { ...notification, readAt: now };
        setNotifications((prev) => [readNotification, ...prev].slice(0, 200));
        void api.notifications.markRead(notification.notificationId);
      } else {
        // Not viewing this thread, or app is not active — alert the user
        setNotifications((prev) => [notification, ...prev].slice(0, 200));
        setUnreadCount((prev) => {
          const next = prev + 1;
          // Update external badges with the new count
          setTitleBadge(next);
          updateAppBadge(next);
          return next;
        });

        if (visibility === "hidden") {
          // Tab hidden / minimized / switched app — OS notification only, no sound
          void showNativeNotification(notification);
        } else {
          // Visible (active on different thread, or passive) — play sound
          playNotificationSound();
        }
      }
    });

    // Clear badges when user returns to the app
    const unsubBecameActive = onAppBecameActive(() => {
      setUnreadCount((current) => {
        // If user is viewing a thread, its notifications will be marked read
        // by the activeThreadId effect — just sync badges to current count
        setTitleBadge(current);
        updateAppBadge(current);
        return current;
      });
      void clearStaleNativeNotifications();
    });

    // Re-register push subscription if the browser rotates it
    const unsubPushChange = installPushSubscriptionChangeListener(api.notifications);

    return () => {
      unsub();
      unsubBecameActive();
      unsubPushChange();
    };
  }, [fetchUnreadCount]);

  // Auto-mark notifications as read when navigating to a thread
  useEffect(() => {
    if (!activeThreadId) return;

    const api = readNativeApi();
    if (api) {
      void api.notifications.markReadByThread(activeThreadId).then(() =>
        api.notifications.unreadCount().then((result) => {
          setUnreadCount(result.count);
          setTitleBadge(result.count);
          updateAppBadge(result.count);
        }),
      );
    }
    markNotificationsReadForThread(activeThreadId, setNotifications, setUnreadCount);
  }, [activeThreadId]);

  // Fetch full list when sheet opens
  useEffect(() => {
    if (isOpen && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void fetchNotifications();
    }
    if (!isOpen) {
      hasLoadedRef.current = false;
    }
  }, [isOpen, fetchNotifications]);

  const handleNavigate = useCallback(
    async (threadId: string, notificationId: string) => {
      const api = readNativeApi();
      if (api) {
        void api.notifications.markRead(notificationId);
        void api.notifications.markOpened(notificationId);
      }

      setNotifications((prev) =>
        prev.map((n) =>
          n.notificationId === notificationId
            ? { ...n, readAt: new Date().toISOString(), openedAt: new Date().toISOString() }
            : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setIsOpen(false);

      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [navigate],
  );

  const handleMarkAllRead = useCallback(async () => {
    const api = readNativeApi();
    if (api) {
      void api.notifications.markAllRead();
    }
    setNotifications((prev) =>
      prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })),
    );
    setUnreadCount(0);
    setTitleBadge(0);
    updateAppBadge(0);
  }, []);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <SheetTrigger
              render={
                <button
                  type="button"
                  aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
                  className="relative inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <BellIcon className="size-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">Notifications</TooltipPopup>
      </Tooltip>
      <SheetPopup side="right" className="w-full max-w-none md:w-96 md:max-w-md">
          <SheetHeader className="flex-row items-center justify-between gap-2 border-b border-border px-5 md:px-4 py-4 md:py-3">
            <SheetTitle className="text-lg md:text-base">Notifications</SheetTitle>
            <SheetDescription className="sr-only">Notification history</SheetDescription>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 md:h-7 gap-2 md:gap-1.5 text-sm md:text-xs"
                onClick={handleMarkAllRead}
              >
                <CheckCheckIcon className="size-4 md:size-3.5" />
                Mark all read
              </Button>
            )}
          </SheetHeader>
          <NotificationPermissionBanner onPermissionChange={fetchUnreadCount} />
          <ScrollArea className="flex-1">
            <div className="flex flex-col divide-y divide-border/50 md:divide-y-0 md:gap-0.5 p-2">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 md:gap-2 py-16 md:py-12 text-muted-foreground">
                  <InboxIcon className="size-12 md:size-8" />
                  <p className="text-base md:text-sm">No notifications yet</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <NotificationItem
                    key={notification.notificationId}
                    notification={notification}
                    onNavigate={handleNavigate}
                  />
                ))
              )}
            </div>
          </ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}
