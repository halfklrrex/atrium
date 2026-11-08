import { PUSH_TOKEN_ID_PATTERN } from '@atrium/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  detectPlatform,
  disablePush,
  enablePush,
  getPushState,
  needsLastSeenRefresh,
  refreshPushLastSeen,
  removeDeviceOnSignOut,
  tokenDocId,
  type PushDeps,
  type PushEnv,
  type PushMarker,
} from './push';

const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';
const TS = { sentinel: 'server-timestamp' };

function makeDeps(
  over: {
    env?: Partial<PushEnv>;
    vapidKey?: string;
    marker?: PushMarker | null;
    exists?: boolean;
  } = {},
) {
  let marker: PushMarker | null = over.marker ?? null;
  const env: PushEnv = {
    userAgent: DESKTOP_UA,
    maxTouchPoints: 0,
    standaloneFlag: undefined,
    displayModeStandalone: false,
    hasNotification: true,
    hasServiceWorker: true,
    hasPushManager: true,
    permission: 'default',
    ...over.env,
  };
  const registration = { scope: '/' } as ServiceWorkerRegistration;
  const deps = {
    env: () => env,
    vapidKey: over.vapidKey ?? 'public-key',
    messagingSupported: vi.fn().mockResolvedValue(true),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    getRegistration: vi.fn().mockResolvedValue(registration),
    getToken: vi.fn().mockResolvedValue('fcm-token-1'),
    deleteToken: vi.fn().mockResolvedValue(true),
    timestamp: () => TS,
    store: {
      exists: vi.fn().mockResolvedValue(over.exists ?? false),
      create: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    marker: {
      read: vi.fn(() => marker),
      write: vi.fn((m: PushMarker | null) => {
        marker = m;
      }),
    },
    now: () => 1_000_000_000_000,
  } satisfies PushDeps;
  return { deps, env, registration };
}

describe('tokenDocId', () => {
  it('is a sha-256 hex that matches the rules pattern', async () => {
    const id = await tokenDocId('abc');
    expect(id).toMatch(PUSH_TOKEN_ID_PATTERN);
    expect(id).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('detectPlatform', () => {
  it('tells ios, android and desktop apart', () => {
    expect(detectPlatform(IPHONE_UA)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', 0)).toBe('desktop');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14) Chrome')).toBe('android');
    expect(detectPlatform(DESKTOP_UA)).toBe('desktop');
  });
});

describe('getPushState', () => {
  it('is unsupported without the browser APIs or firebase/messaging support', async () => {
    expect(await getPushState(makeDeps({ env: { hasPushManager: false } }).deps, 'u1')).toBe(
      'unsupported',
    );
    const { deps } = makeDeps();
    deps.messagingSupported.mockResolvedValue(false);
    expect(await getPushState(deps, 'u1')).toBe('unsupported');
  });

  it('asks an iPhone that is not installed to install first, even without PushManager', async () => {
    const { deps } = makeDeps({ env: { userAgent: IPHONE_UA, hasPushManager: false } });
    expect(await getPushState(deps, 'u1')).toBe('ios-install');
  });

  it('treats an installed iPhone (standalone) like any supported browser', async () => {
    const { deps } = makeDeps({ env: { userAgent: IPHONE_UA, standaloneFlag: true } });
    expect(await getPushState(deps, 'u1')).toBe('off');
    const second = makeDeps({ env: { userAgent: IPHONE_UA, displayModeStandalone: true } });
    expect(await getPushState(second.deps, 'u1')).toBe('off');
  });

  it('is not-configured while the VAPID key is empty', async () => {
    expect(await getPushState(makeDeps({ vapidKey: '' }).deps, 'u1')).toBe('not-configured');
  });

  it('is blocked when permission is denied, off by default, on for this person with a token doc', async () => {
    expect(await getPushState(makeDeps({ env: { permission: 'denied' } }).deps, 'u1')).toBe(
      'blocked',
    );
    expect(await getPushState(makeDeps().deps, 'u1')).toBe('off');
    const marker = { uid: 'u1', id: 'a'.repeat(64), seenAt: 1 };
    const on = makeDeps({ env: { permission: 'granted' }, marker, exists: true });
    expect(await getPushState(on.deps, 'u1')).toBe('on');
    // Another person signed in on this browser, or the doc was pruned: off.
    expect(await getPushState(on.deps, 'u2')).toBe('off');
    const pruned = makeDeps({ env: { permission: 'granted' }, marker, exists: false });
    expect(await getPushState(pruned.deps, 'u1')).toBe('off');
  });
});

describe('enablePush', () => {
  it('never asks for permission while the VAPID key is empty', async () => {
    const { deps } = makeDeps({ vapidKey: '' });
    expect(await enablePush(deps, 'u1', vi.fn())).toBe('unavailable');
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.getToken).not.toHaveBeenCalled();
  });

  it('asks, gets the token with the VAPID key and registration, and writes the exact doc', async () => {
    const { deps, registration } = makeDeps();
    const prefs = vi.fn().mockResolvedValue(undefined);
    expect(await enablePush(deps, 'u1', prefs)).toBe('enabled');
    expect(deps.getToken).toHaveBeenCalledWith({
      vapidKey: 'public-key',
      serviceWorkerRegistration: registration,
    });
    const id = await tokenDocId('fcm-token-1');
    expect(deps.store.create).toHaveBeenCalledWith('u1', id, {
      token: 'fcm-token-1',
      userAgent: DESKTOP_UA,
      platform: 'desktop',
      createdAt: TS,
      lastSeenAt: TS,
    });
    expect(deps.marker.write).toHaveBeenCalledWith({ uid: 'u1', id, seenAt: 1_000_000_000_000 });
    expect(prefs).toHaveBeenCalledOnce();
  });

  it('caps the user agent at 200 characters', async () => {
    const { deps } = makeDeps({ env: { userAgent: `${DESKTOP_UA} ${'x'.repeat(400)}` } });
    await enablePush(deps, 'u1', vi.fn());
    const written = deps.store.create.mock.calls[0]?.[2] as { userAgent: string };
    expect(written.userAgent).toHaveLength(200);
  });

  it('writes nothing when the person refuses or dismisses the prompt', async () => {
    const denied = makeDeps();
    denied.deps.requestPermission.mockResolvedValue('denied');
    expect(await enablePush(denied.deps, 'u1', vi.fn())).toBe('denied');
    const dismissed = makeDeps();
    dismissed.deps.requestPermission.mockResolvedValue('default');
    expect(await enablePush(dismissed.deps, 'u1', vi.fn())).toBe('dismissed');
    expect(denied.deps.store.create).not.toHaveBeenCalled();
    expect(dismissed.deps.getToken).not.toHaveBeenCalled();
  });

  it('only refreshes lastSeenAt when the token doc already exists', async () => {
    const { deps } = makeDeps({ exists: true });
    await enablePush(deps, 'u1', vi.fn());
    expect(deps.store.create).not.toHaveBeenCalled();
    expect(deps.store.touch).toHaveBeenCalledWith('u1', expect.any(String), { lastSeenAt: TS });
  });
});

describe('disablePush', () => {
  const marker = { uid: 'u1', id: 'b'.repeat(64), seenAt: 1 };

  it('deletes the token doc and the FCM token, then forgets the device', async () => {
    const { deps } = makeDeps({ marker });
    await disablePush(deps, 'u1');
    expect(deps.store.remove).toHaveBeenCalledWith('u1', marker.id);
    expect(deps.deleteToken).toHaveBeenCalledOnce();
    expect(deps.marker.write).toHaveBeenCalledWith(null);
  });

  it('leaves a device that belongs to somebody else alone', async () => {
    const { deps } = makeDeps({ marker });
    await disablePush(deps, 'u2');
    expect(deps.store.remove).not.toHaveBeenCalled();
    expect(deps.deleteToken).not.toHaveBeenCalled();
  });

  it('still deletes the FCM token when the doc delete fails, and reports the failure', async () => {
    const { deps } = makeDeps({ marker });
    deps.store.remove.mockRejectedValue(new Error('offline'));
    await expect(disablePush(deps, 'u1')).rejects.toThrow('offline');
    expect(deps.deleteToken).toHaveBeenCalledOnce();
  });
});

describe('removeDeviceOnSignOut', () => {
  const marker = { uid: 'u1', id: 'c'.repeat(64), seenAt: 1 };

  it('removes this device', async () => {
    const { deps } = makeDeps({ marker });
    await removeDeviceOnSignOut(deps, 'u1');
    expect(deps.store.remove).toHaveBeenCalledWith('u1', marker.id);
    expect(deps.deleteToken).toHaveBeenCalled();
  });

  it('never throws, even when everything fails', async () => {
    const { deps } = makeDeps({ marker });
    deps.store.remove.mockRejectedValue(new Error('x'));
    deps.deleteToken.mockRejectedValue(new Error('y'));
    await expect(removeDeviceOnSignOut(deps, 'u1')).resolves.toBeUndefined();
    expect(deps.marker.write).toHaveBeenLastCalledWith(null);
  });

  it('does not wait longer than the timeout when the network hangs', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps({ marker });
      deps.store.remove.mockReturnValue(new Promise(() => {}));
      const done = removeDeviceOnSignOut(deps, 'u1', 50);
      await vi.advanceTimersByTimeAsync(60);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing without a signed-in person', async () => {
    const { deps } = makeDeps({ marker });
    await removeDeviceOnSignOut(deps, undefined);
    expect(deps.store.remove).not.toHaveBeenCalled();
  });
});

describe('once-a-day lastSeenAt refresh', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_000_000_000_000;

  it('is due after a day for the same person only', () => {
    const marker = { uid: 'u1', id: 'd'.repeat(64), seenAt: now - DAY };
    expect(needsLastSeenRefresh(marker, 'u1', now)).toBe(true);
    expect(needsLastSeenRefresh({ ...marker, seenAt: now - DAY + 1 }, 'u1', now)).toBe(false);
    expect(needsLastSeenRefresh(marker, 'u2', now)).toBe(false);
    expect(needsLastSeenRefresh(null, 'u1', now)).toBe(false);
  });

  it('writes only lastSeenAt and remembers the time', async () => {
    const marker = { uid: 'u1', id: 'd'.repeat(64), seenAt: now - DAY };
    const { deps } = makeDeps({ marker, env: { permission: 'granted' } });
    expect(await refreshPushLastSeen(deps, 'u1')).toBe(true);
    expect(deps.store.touch).toHaveBeenCalledWith('u1', marker.id, { lastSeenAt: TS });
    expect(deps.marker.write).toHaveBeenCalledWith({ ...marker, seenAt: now });
    expect(await refreshPushLastSeen(deps, 'u1')).toBe(false);
  });

  it('does nothing when push was never enabled here', async () => {
    const { deps } = makeDeps({ env: { permission: 'granted' } });
    expect(await refreshPushLastSeen(deps, 'u1')).toBe(false);
    expect(deps.store.touch).not.toHaveBeenCalled();
  });
});

describe('VAPID_PUBLIC_KEY', () => {
  it('is a plausible web push key: 87 base64url characters, 65 bytes, uncompressed P-256 point', async () => {
    const { VAPID_PUBLIC_KEY } = await import('./firebase');
    expect(VAPID_PUBLIC_KEY).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const bytes = Uint8Array.from(Buffer.from(VAPID_PUBLIC_KEY, 'base64url'));
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });
});
