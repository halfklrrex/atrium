import { PUSH_TOKEN_ID_PATTERN, type PushToken } from '@atrium/shared';

/**
 * Web push on this device (PWA-4, docs/pwa.md). Everything here is pure or takes its browser and
 * Firebase pieces through `PushDeps`, so it can be tested without a real permission prompt. The
 * real wiring is in `push-runtime.ts`.
 */

export type PushPlatform = PushToken['platform'];

/** What the "On this device" section shows. */
export type PushDeviceState =
  'unsupported' | 'ios-install' | 'not-configured' | 'blocked' | 'off' | 'on';

/** Remembered in this browser after Enable: which signed-in person's token doc is this device. */
export interface PushMarker {
  uid: string;
  /** The token doc id (sha-256 hex of the FCM token). */
  id: string;
  /** Epoch ms of the last `lastSeenAt` write. */
  seenAt: number;
}

/** The part of a token doc the client writes; the two timestamps are added by `deps.timestamp()`. */
export type PushTokenInput = Pick<PushToken, 'token' | 'userAgent' | 'platform'>;

export interface PushEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** `navigator.standalone` (iOS Safari). */
  standaloneFlag: boolean | undefined;
  /** `matchMedia('(display-mode: standalone)').matches`. */
  displayModeStandalone: boolean;
  hasNotification: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  /** `Notification.permission`, when `Notification` exists. */
  permission: NotificationPermission | undefined;
}

export interface PushDeps {
  env: () => PushEnv;
  vapidKey: string;
  /** `isSupported()` from firebase/messaging. */
  messagingSupported: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  /** The registration of /sw.js (registering it when the page has none yet). */
  getRegistration: () => Promise<ServiceWorkerRegistration>;
  getToken: (options: {
    vapidKey: string;
    serviceWorkerRegistration: ServiceWorkerRegistration;
  }) => Promise<string>;
  /** FCM `deleteToken` for this browser. */
  deleteToken: () => Promise<unknown>;
  /** A Firestore server timestamp sentinel. */
  timestamp: () => unknown;
  store: {
    exists: (uid: string, id: string) => Promise<boolean>;
    create: (uid: string, id: string, data: Record<string, unknown>) => Promise<void>;
    touch: (uid: string, id: string, data: Record<string, unknown>) => Promise<void>;
    remove: (uid: string, id: string) => Promise<void>;
  };
  marker: {
    read: () => PushMarker | null;
    write: (marker: PushMarker | null) => void;
  };
  now: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sign-out waits at most this long for the device to be removed. */
export const SIGN_OUT_PUSH_TIMEOUT_MS = 3000;
const USER_AGENT_MAX = 200;

export function detectPlatform(userAgent: string, maxTouchPoints = 0): PushPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  // iPadOS 13+ Safari reports a Mac user agent; the touch screen gives it away.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

export function isStandalone(env: PushEnv): boolean {
  return env.standaloneFlag === true || env.displayModeStandalone;
}

/** Lowercase sha-256 hex (64 chars) of the FCM token: the token doc id. */
export async function tokenDocId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const id = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (!PUSH_TOKEN_ID_PATTERN.test(id)) throw new Error('Unexpected token id');
  return id;
}

/** Which state the section shows. `uid` decides whether the remembered device is this person's. */
export async function getPushState(
  deps: PushDeps,
  uid: string | undefined,
): Promise<PushDeviceState> {
  const env = deps.env();
  if (detectPlatform(env.userAgent, env.maxTouchPoints) === 'ios' && !isStandalone(env)) {
    // Safari only exposes push to an installed web app, so the missing APIs here mean "install".
    return 'ios-install';
  }
  if (!env.hasNotification || !env.hasServiceWorker || !env.hasPushManager) return 'unsupported';
  if (!(await deps.messagingSupported().catch(() => false))) return 'unsupported';
  if (!deps.vapidKey) return 'not-configured';
  if (env.permission === 'denied') return 'blocked';
  if (env.permission === 'granted' && uid) {
    const marker = deps.marker.read();
    if (
      marker &&
      marker.uid === uid &&
      (await deps.store.exists(uid, marker.id).catch(() => false))
    ) {
      return 'on';
    }
  }
  return 'off';
}

export type EnableResult = 'enabled' | 'denied' | 'dismissed' | 'unavailable';

/**
 * Turns push on for this device. Call it only from the person's click: it is the only place that
 * asks for permission, and it never asks when the state is not `off`.
 * `ensureDefaultPrefs` writes `notificationPrefs.push` when the person has none yet.
 */
export async function enablePush(
  deps: PushDeps,
  uid: string,
  ensureDefaultPrefs: () => Promise<void>,
): Promise<EnableResult> {
  if ((await getPushState(deps, uid)) !== 'off') return 'unavailable';
  const permission = await deps.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'dismissed';

  const env = deps.env();
  const registration = await deps.getRegistration();
  const token = await deps.getToken({
    vapidKey: deps.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) return 'unavailable';
  const id = await tokenDocId(token);

  if (await deps.store.exists(uid, id)) {
    // The same browser token again (storage was cleared): the rules only allow `lastSeenAt` to change.
    await deps.store.touch(uid, id, { lastSeenAt: deps.timestamp() });
  } else {
    await deps.store.create(uid, id, {
      token,
      userAgent: env.userAgent.slice(0, USER_AGENT_MAX),
      platform: detectPlatform(env.userAgent, env.maxTouchPoints),
      createdAt: deps.timestamp(),
      lastSeenAt: deps.timestamp(),
    });
  }
  deps.marker.write({ uid, id, seenAt: deps.now() });
  await ensureDefaultPrefs();
  return 'enabled';
}

/**
 * Turns push off for this device: deletes this device's token doc and the browser's FCM token.
 * Only acts on a device remembered for `uid`. Each step is attempted even when an earlier one failed;
 * the first error is rethrown at the end so the UI can say so.
 */
export async function disablePush(deps: PushDeps, uid: string): Promise<void> {
  const marker = deps.marker.read();
  if (!marker || marker.uid !== uid) return;
  let failure: unknown;
  try {
    await deps.store.remove(uid, marker.id);
  } catch (error) {
    failure = error;
  }
  try {
    await deps.deleteToken();
  } catch (error) {
    failure ??= error;
  }
  if (failure === undefined) deps.marker.write(null);
  else throw failure;
}

/**
 * Sign-out hook (owner answer 2026-11-07): removes this device's token, best effort. Never throws and
 * never waits longer than `SIGN_OUT_PUSH_TIMEOUT_MS`, so it cannot block signing out.
 */
export async function removeDeviceOnSignOut(
  deps: PushDeps,
  uid: string | undefined,
  timeoutMs = SIGN_OUT_PUSH_TIMEOUT_MS,
): Promise<void> {
  if (!uid) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([disablePush(deps, uid).catch(() => {}), timeout]);
  } catch {
    // Best effort.
  } finally {
    clearTimeout(timer);
    // Whatever happened, this browser no longer belongs to the person signing out.
    try {
      const marker = deps.marker.read();
      if (marker?.uid === uid) deps.marker.write(null);
    } catch {
      // Storage may be unavailable.
    }
  }
}

/** True when the remembered device of `uid` has not refreshed `lastSeenAt` for a day. */
export function needsLastSeenRefresh(marker: PushMarker | null, uid: string, now: number): boolean {
  return Boolean(marker && marker.uid === uid && now - marker.seenAt >= DAY_MS);
}

/** App load: refreshes `lastSeenAt` (only that key) at most once a day for an enabled device. */
export async function refreshPushLastSeen(deps: PushDeps, uid: string): Promise<boolean> {
  const marker = deps.marker.read();
  const now = deps.now();
  if (!marker || !needsLastSeenRefresh(marker, uid, now)) return false;
  if (deps.env().permission !== 'granted') return false;
  try {
    await deps.store.touch(uid, marker.id, { lastSeenAt: deps.timestamp() });
    deps.marker.write({ ...marker, seenAt: now });
    return true;
  } catch {
    return false;
  }
}
