import {
  DEFAULT_PUSH_PREFS,
  type NotificationKind,
  type NotificationPrefs,
  type PushPrefs,
} from '@atrium/shared';
import type { NewNotification, NotificationStore, NotificationUpsertStore } from './notifications';

/**
 * Web push for the bell (PWA-3, docs/specs/P4-pwa-web-push.md). After a notification is newly
 * written, `sendPush` sends a DATA-ONLY FCM message to the recipient's opted-in devices
 * (`users/{uid}/pushTokens`). It is best effort: it never throws, and it never logs a token or a
 * message text (only the uid, the notification id, counts and error codes).
 */

/** Deep links are absolute so the service worker can open them from any state. */
export const APP_BASE_URL = 'https://atrium-workboards.web.app';

/** FCM accepts at most 500 tokens per multicast. */
export const MULTICAST_CHUNK = 500;

/** FCM error codes that mean the token is dead for good: its doc is deleted. */
const DEAD_TOKEN_CODES: ReadonlySet<string> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Which push switch a notification kind follows. A kind missing here pushes nothing (fail closed).
 * `automation_disabled` follows `automation`, as in the bell. The Inbox kinds have their own
 * `inbox` switch (owner decision); someone who turns it off still sees them in the bell.
 */
const PUSH_KEY_OF: Partial<Record<NotificationKind, keyof PushPrefs>> = {
  assigned: 'assigned',
  reply: 'reply',
  mention: 'mention',
  button: 'button',
  automation: 'automation',
  automation_disabled: 'automation',
  account_request: 'account',
  account_approved: 'account',
  inbox_new: 'inbox',
  inbox_reply: 'inbox',
};

export interface PushTokenRef {
  /** The token document id (a hash), used to delete it. */
  id: string;
  /** The FCM registration token. Never logged. */
  token: string;
}

export interface PushTokenStore {
  listTokens(uid: string): Promise<PushTokenRef[]>;
  /** `users/{uid}.notificationPrefs`, `undefined` when unset. */
  getPrefs(uid: string): Promise<Partial<NotificationPrefs> | undefined>;
  deleteToken(uid: string, tokenId: string): Promise<void>;
}

export interface PushMessage {
  tokens: string[];
  /** Data only: no `notification` field, so the service worker builds the notification. */
  data: Record<string, string>;
  webpush: { headers: Record<string, string> };
}

export interface PushMessaging {
  sendEachForMulticast(message: PushMessage): Promise<{
    responses: ReadonlyArray<{ success: boolean; error?: { code?: string } }>;
  }>;
}

export interface PushLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface PushDeps {
  store: PushTokenStore;
  messaging: PushMessaging;
  logger: PushLogger;
}

/** What `sendPush` needs from the notification doc: only fields the bell shows. */
export type PushNotificationData = Pick<
  NewNotification,
  | 'kind'
  | 'actorName'
  | 'boardId'
  | 'boardName'
  | 'itemId'
  | 'itemName'
  | 'snippet'
  | 'buttonLabel'
  | 'recipeName'
  | 'updateId'
  | 'replyId'
>;

const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : 'unknown';
};

/** The bell's action text (`actionText` in the web app's notification-filter). */
function actionText(n: PushNotificationData): string {
  switch (n.kind) {
    case 'assigned':
      return 'assigned you to an item';
    case 'reply':
      return 'replied to your update';
    case 'mention':
      if (n.replyId) return 'mentioned you in a reply';
      return n.updateId ? 'mentioned you in an update' : 'mentioned you in a description';
    case 'button':
      return n.buttonLabel ? `clicked "${n.buttonLabel}"` : 'clicked a button';
    case 'automation':
      return n.recipeName ? `ran automation "${n.recipeName}"` : 'ran an automation';
    case 'automation_disabled':
      return n.recipeName ? `turned off automation "${n.recipeName}"` : 'turned off an automation';
    case 'account_request':
      return 'asked for access';
    case 'account_approved':
      return 'approved your account';
    case 'inbox_new':
      return 'wrote to the site admins';
    case 'inbox_reply':
      return 'replied to your feedback';
  }
}

const isPlaceholderRef = (kind: NotificationKind): boolean =>
  kind === 'account_request' ||
  kind === 'account_approved' ||
  kind === 'inbox_new' ||
  kind === 'inbox_reply';

/**
 * The deep link, following the bell's routing (`openNotification` in NotificationsPanel): inbox
 * kinds open the thread (`itemId` is the thread id), `account_request` opens /admin,
 * `account_approved` opens the app, the rest open the item. The update or reply to scroll to is
 * router state in the web app, so a URL cannot carry it: the item opens.
 */
export function pushUrl(n: PushNotificationData): string {
  switch (n.kind) {
    case 'inbox_new':
      return `${APP_BASE_URL}/admin/inbox/${encodeURIComponent(n.itemId)}`;
    case 'inbox_reply':
      return `${APP_BASE_URL}/feedback/${encodeURIComponent(n.itemId)}`;
    case 'account_request':
      return `${APP_BASE_URL}/admin`;
    case 'account_approved':
      return `${APP_BASE_URL}/`;
    default:
      return `${APP_BASE_URL}/boards/${encodeURIComponent(n.boardId)}/items/${encodeURIComponent(n.itemId)}`;
  }
}

/** Collapse key: one per item (or thread), so a burst replaces the previous notification. */
export function pushTag(n: PushNotificationData): string {
  return isPlaceholderRef(n.kind) ? `${n.kind}-${n.itemId}` : `item-${n.boardId}-${n.itemId}`;
}

/** Title and body use only what the bell shows (actor name, action, snippet, item and board). */
export function pushText(n: PushNotificationData): { title: string; body: string } {
  const title = `${n.actorName || 'Someone'} ${actionText(n)}`;
  if (n.snippet) return { title, body: n.snippet };
  if (isPlaceholderRef(n.kind)) return { title, body: '' };
  return { title, body: [n.itemName, n.boardName].filter(Boolean).join(' · ') };
}

/** The data-only payload. FCM data values must be strings. */
export function buildPushData(n: PushNotificationData): Record<string, string> {
  const { title, body } = pushText(n);
  return { title, body, url: pushUrl(n), tag: pushTag(n), kind: n.kind };
}

/**
 * Sends the push for one newly written notification. Never throws: a failure is logged with the
 * uid, the notification id and an error code, and swallowed.
 */
export async function sendPush(
  deps: PushDeps,
  uid: string,
  notificationId: string,
  data: PushNotificationData,
): Promise<void> {
  const { store, messaging, logger } = deps;
  try {
    const key = PUSH_KEY_OF[data.kind];
    if (!key) return; // unknown kind: fail closed

    const tokens = await store.listTokens(uid);
    if (tokens.length === 0) return;

    const prefs = await store.getPrefs(uid);
    const enabled = { ...DEFAULT_PUSH_PREFS, ...prefs?.push }[key];
    if (!enabled) return;

    const payload = buildPushData(data);
    const dead: PushTokenRef[] = [];
    let sent = 0;
    for (let i = 0; i < tokens.length; i += MULTICAST_CHUNK) {
      const chunk = tokens.slice(i, i + MULTICAST_CHUNK);
      try {
        const result = await messaging.sendEachForMulticast({
          tokens: chunk.map((t) => t.token),
          data: payload,
          webpush: { headers: { Urgency: 'high', TTL: '86400' } },
        });
        result.responses.forEach((response, index) => {
          if (response.success) {
            sent += 1;
            return;
          }
          const code = response.error?.code ?? 'unknown';
          const ref = chunk[index];
          if (ref && DEAD_TOKEN_CODES.has(code)) dead.push(ref);
          else logger.warn('Push: a send failed', { uid, notificationId, code });
        });
      } catch (error) {
        logger.error('Push: send failed', { uid, notificationId, code: errorCode(error) });
      }
    }

    for (const ref of dead) {
      try {
        await store.deleteToken(uid, ref.id);
      } catch (error) {
        logger.warn('Push: could not delete a dead token', {
          uid,
          notificationId,
          code: errorCode(error),
        });
      }
    }
    logger.info('Push: done', {
      uid,
      notificationId,
      devices: tokens.length,
      sent,
      pruned: dead.length,
    });
  } catch (error) {
    logger.error('Push: failed', { uid, notificationId, code: errorCode(error) });
  }
}

/**
 * Wraps a notification store so every newly written notification is pushed, from the same
 * invocation: `createNotification` pushes only when it returns `true` (a retried trigger finds the
 * doc and pushes nothing); `upsertNotification` (Inbox kinds, called once per new message) pushes
 * after the write. `push` must not throw (`sendPush` never does); a throw is swallowed anyway so a
 * push can never fail or block a notification.
 */
export function withPushOnCreate<S extends Partial<NotificationStore & NotificationUpsertStore>>(
  store: S,
  push: (uid: string, id: string, data: NewNotification) => Promise<void>,
): S {
  const safePush = async (uid: string, id: string, data: NewNotification) => {
    try {
      await push(uid, id, data);
    } catch {
      // swallowed: best effort
    }
  };
  return {
    ...store,
    ...(store.createNotification
      ? {
          createNotification: async (uid: string, id: string, data: NewNotification) => {
            const created = await store.createNotification!(uid, id, data);
            if (created) await safePush(uid, id, data);
            return created;
          },
        }
      : {}),
    ...(store.upsertNotification
      ? {
          upsertNotification: async (uid: string, id: string, data: NewNotification) => {
            await store.upsertNotification!(uid, id, data);
            await safePush(uid, id, data);
          },
        }
      : {}),
  };
}
