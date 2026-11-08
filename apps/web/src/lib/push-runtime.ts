import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { app, db, VAPID_PUBLIC_KEY } from './firebase';
import type { PushDeps, PushEnv, PushMarker } from './push';

/** Real browser and Firebase wiring for `push.ts`. Loaded by the settings dialog and the shell. */

const MARKER_KEY = 'atrium.push.device';

function tokenRef(uid: string, id: string) {
  return doc(collection(db, 'users', uid, 'pushTokens'), id);
}

function readEnv(): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standaloneFlag: nav.standalone,
    displayModeStandalone:
      typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
    hasNotification: typeof Notification !== 'undefined',
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    permission: typeof Notification !== 'undefined' ? Notification.permission : undefined,
  };
}

function readMarker(): PushMarker | null {
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PushMarker>;
    return typeof value.uid === 'string' &&
      typeof value.id === 'string' &&
      typeof value.seenAt === 'number'
      ? { uid: value.uid, id: value.id, seenAt: value.seenAt }
      : null;
  } catch {
    return null;
  }
}

function writeMarker(marker: PushMarker | null): void {
  try {
    if (marker) localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
    else localStorage.removeItem(MARKER_KEY);
  } catch {
    // Storage may be blocked; the device then simply shows as off next time.
  }
}

async function messagingModule() {
  return import('firebase/messaging');
}

export const pushDeps: PushDeps = {
  env: readEnv,
  vapidKey: VAPID_PUBLIC_KEY,
  messagingSupported: async () => (await messagingModule()).isSupported(),
  requestPermission: () => Notification.requestPermission(),
  getRegistration: async () =>
    (await navigator.serviceWorker.getRegistration('/')) ??
    navigator.serviceWorker.register('/sw.js', { scope: '/' }),
  getToken: async (options) => {
    const { getMessaging, getToken } = await messagingModule();
    return getToken(getMessaging(app), options);
  },
  deleteToken: async () => {
    const { getMessaging, deleteToken } = await messagingModule();
    return deleteToken(getMessaging(app));
  },
  timestamp: () => serverTimestamp(),
  store: {
    exists: async (uid, id) => (await getDoc(tokenRef(uid, id))).exists(),
    create: (uid, id, data) => setDoc(tokenRef(uid, id), data),
    touch: (uid, id, data) => updateDoc(tokenRef(uid, id), data),
    remove: (uid, id) => deleteDoc(tokenRef(uid, id)),
  },
  marker: { read: readMarker, write: writeMarker },
  now: () => Date.now(),
};
