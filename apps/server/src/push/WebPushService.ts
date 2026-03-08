import path from "node:path";
import fs from "node:fs";

import webpush from "web-push";
import { Effect, Layer, ServiceMap } from "effect";

import { ServerConfig } from "../config.ts";
import {
  ProjectionPushSubscriptionRepository,
  type ProjectionPushSubscription,
} from "../persistence/Services/ProjectionPushSubscriptions.ts";
import { createLogger } from "../logger.ts";

const logger = createLogger("WebPushService");

export interface WebPushServiceShape {
  readonly getVapidPublicKey: () => string | null;
  readonly sendToAll: (payload: {
    title: string;
    body: string;
    notificationId: string;
    threadId: string;
  }) => Effect.Effect<void, never>;
}

export class WebPushService extends ServiceMap.Service<WebPushService, WebPushServiceShape>()(
  "xbe/push/WebPushService",
) {}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function loadOrGenerateVapidKeys(stateDir: string): VapidKeys | null {
  const keysPath = path.join(stateDir, "vapid-keys.json");
  try {
    if (fs.existsSync(keysPath)) {
      const raw = fs.readFileSync(keysPath, "utf-8");
      const keys = JSON.parse(raw) as VapidKeys;
      if (keys.publicKey && keys.privateKey) {
        return keys;
      }
    }
  } catch {
    logger.warn("Failed to read VAPID keys, regenerating");
  }

  try {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(keysPath), { recursive: true });
    fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2));
    logger.info("Generated new VAPID keys");
    return keys;
  } catch (error) {
    logger.warn("Failed to generate VAPID keys", { error });
    return null;
  }
}

function sendPushToSubscription(
  sub: ProjectionPushSubscription,
  payloadString: string,
): Promise<webpush.SendResult> {
  return webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
    },
    payloadString,
  );
}

const makeWebPushService = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const pushSubscriptionRepository = yield* ProjectionPushSubscriptionRepository;

  const vapidKeys = loadOrGenerateVapidKeys(config.stateDir);
  if (vapidKeys) {
    webpush.setVapidDetails("mailto:noreply@xbe.tools", vapidKeys.publicKey, vapidKeys.privateKey);
    logger.info("Web Push initialized with VAPID keys");
  } else {
    logger.warn("Web Push disabled — VAPID key generation failed");
  }

  const getVapidPublicKey: WebPushServiceShape["getVapidPublicKey"] = () =>
    vapidKeys?.publicKey ?? null;

  const sendToAll: WebPushServiceShape["sendToAll"] = (payload) =>
    Effect.gen(function* () {
      if (!vapidKeys) return;

      const subscriptions = yield* pushSubscriptionRepository.listAll().pipe(
        Effect.catch(() => Effect.succeed([] as ReadonlyArray<ProjectionPushSubscription>)),
      );

      if (subscriptions.length === 0) return;

      const payloadString = JSON.stringify(payload);
      const now = new Date().toISOString();

      for (const sub of subscriptions) {
        yield* Effect.tryPromise({
          try: () => sendPushToSubscription(sub, payloadString),
          catch: (error): WebPushError => new WebPushError({ cause: error }),
        }).pipe(
          Effect.tap(() =>
            pushSubscriptionRepository.updateLastUsedAt(sub.endpoint, now).pipe(
              Effect.catch(() => Effect.void),
            ),
          ),
          Effect.catch((error) => {
            const cause = error instanceof WebPushError ? error.cause : null;
            const statusCode =
              cause && typeof cause === "object" && "statusCode" in cause
                ? (cause as { statusCode: number }).statusCode
                : null;
            if (statusCode === 404 || statusCode === 410) {
              return pushSubscriptionRepository.deleteByEndpoint(sub.endpoint).pipe(
                Effect.catch(() => Effect.void),
              );
            }
            return Effect.void;
          }),
        );
      }
    }).pipe(Effect.asVoid);

  return {
    getVapidPublicKey,
    sendToAll,
  } satisfies WebPushServiceShape;
});

class WebPushError {
  readonly _tag = "WebPushError";
  constructor(readonly options: { cause: unknown }) {}
  get cause() {
    return this.options.cause;
  }
}

export const WebPushServiceLive = Layer.effect(WebPushService, makeWebPushService);
