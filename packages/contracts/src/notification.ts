import { Schema } from "effect";
import { EventId, IsoDateTime, ThreadId } from "./baseSchemas";

export const NOTIFICATION_WS_METHODS = {
  list: "notification.list",
  unreadCount: "notification.unreadCount",
  markRead: "notification.markRead",
  markAllRead: "notification.markAllRead",
  markReadByThread: "notification.markReadByThread",
  markOpened: "notification.markOpened",
  getVapidPublicKey: "notification.getVapidPublicKey",
  subscribePush: "notification.subscribePush",
  unsubscribePush: "notification.unsubscribePush",
} as const;

export const NOTIFICATION_WS_CHANNELS = {
  created: "notification.created",
} as const;

export const NotificationKind = Schema.Literals([
  "turn-completed",
  "approval-needed",
  "input-needed",
]);
export type NotificationKind = typeof NotificationKind.Type;

export const AppNotification = Schema.Struct({
  notificationId: Schema.String,
  sourceEventId: EventId,
  threadId: ThreadId,
  kind: NotificationKind,
  title: Schema.String,
  body: Schema.String,
  readAt: Schema.NullOr(IsoDateTime),
  openedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
});
export type AppNotification = typeof AppNotification.Type;

export const NotificationListInput = Schema.Struct({
  limit: Schema.Number.pipe(Schema.withDecodingDefault(() => 50)),
  offset: Schema.Number.pipe(Schema.withDecodingDefault(() => 0)),
});
export type NotificationListInput = typeof NotificationListInput.Type;

export const NotificationListResult = Schema.Struct({
  notifications: Schema.Array(AppNotification),
  totalUnread: Schema.Number,
});
export type NotificationListResult = typeof NotificationListResult.Type;

export const NotificationUnreadCountResult = Schema.Struct({
  count: Schema.Number,
});
export type NotificationUnreadCountResult = typeof NotificationUnreadCountResult.Type;

export const NotificationMarkReadInput = Schema.Struct({
  notificationId: Schema.String,
});
export type NotificationMarkReadInput = typeof NotificationMarkReadInput.Type;

export const NotificationMarkReadByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type NotificationMarkReadByThreadInput = typeof NotificationMarkReadByThreadInput.Type;

export const NotificationMarkOpenedInput = Schema.Struct({
  notificationId: Schema.String,
});
export type NotificationMarkOpenedInput = typeof NotificationMarkOpenedInput.Type;

export const PushSubscriptionInput = Schema.Struct({
  endpoint: Schema.String,
  p256dhKey: Schema.String,
  authKey: Schema.String,
});
export type PushSubscriptionInput = typeof PushSubscriptionInput.Type;

export const PushUnsubscribeInput = Schema.Struct({
  endpoint: Schema.String,
});
export type PushUnsubscribeInput = typeof PushUnsubscribeInput.Type;

export const VapidPublicKeyResult = Schema.Struct({
  publicKey: Schema.NullOr(Schema.String),
});
export type VapidPublicKeyResult = typeof VapidPublicKeyResult.Type;
