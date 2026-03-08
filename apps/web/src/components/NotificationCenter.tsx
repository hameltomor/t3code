import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { BellIcon, CheckCheckIcon, InboxIcon } from "lucide-react";
import type { AppNotification } from "@xbetools/contracts";

import { readNativeApi } from "../nativeApi";
import { playNotificationSound, showNativeNotification } from "../lib/notifications";
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
        "flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
        isUnread && "bg-muted/30",
      )}
      onClick={() => onNavigate(notification.threadId, notification.notificationId)}
    >
      <div className="mt-0.5 flex-shrink-0">
        <div
          className={cn(
            "size-2 rounded-full",
            isUnread ? "bg-primary" : "bg-transparent",
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-xs font-medium", isUnread ? "text-primary" : "text-muted-foreground")}>
            {NOTIFICATION_KIND_LABELS[notification.kind] ?? notification.kind}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatNotificationTime(notification.createdAt)}
          </span>
        </div>
        <p className={cn("text-sm mt-0.5 line-clamp-2", isUnread ? "text-foreground" : "text-muted-foreground")}>
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

      if (isActiveThread) {
        // User is viewing this thread — mark as read immediately, no sound/alert
        const now = new Date().toISOString();
        const readNotification = { ...notification, readAt: now };
        setNotifications((prev) => [readNotification, ...prev].slice(0, 200));
        void api.notifications.markRead(notification.notificationId);
      } else {
        setNotifications((prev) => [notification, ...prev].slice(0, 200));
        setUnreadCount((prev) => prev + 1);
        playNotificationSound();
        void showNativeNotification(notification);
      }
    });

    return unsub;
  }, [fetchUnreadCount]);

  // Auto-mark notifications as read when navigating to a thread
  useEffect(() => {
    if (!activeThreadId) return;

    const api = readNativeApi();
    if (api) {
      void api.notifications.markReadByThread(activeThreadId);
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
                  className="relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
      <SheetPopup side="right" className="w-80 sm:w-96">
          <SheetHeader className="flex-row items-center justify-between gap-2 border-b border-border px-4 py-3">
            <SheetTitle className="text-base">Notifications</SheetTitle>
            <SheetDescription className="sr-only">Notification history</SheetDescription>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleMarkAllRead}
              >
                <CheckCheckIcon className="size-3.5" />
                Mark all read
              </Button>
            )}
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-0.5 p-2">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                  <InboxIcon className="size-8" />
                  <p className="text-sm">No notifications yet</p>
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
