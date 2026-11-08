import type { PushPrefs } from '@atrium/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  disablePush,
  enablePush,
  getPushState,
  type PushDeps,
  type PushDeviceState,
} from '../../lib/push';
import { pushDeps as realPushDeps } from '../../lib/push-runtime';
import { showToast } from '../toast-store';

/** The seven push switches, in the order shown. */
export const PUSH_KINDS: readonly { kind: keyof PushPrefs; label: string; hint: string }[] = [
  { kind: 'assigned', label: 'Assigned to me', hint: 'Someone adds you to a People column.' },
  { kind: 'reply', label: 'Replies', hint: 'Someone replies to an update you wrote.' },
  { kind: 'mention', label: 'Mentions', hint: 'Someone mentions you in an update or reply.' },
  { kind: 'button', label: 'Button clicks', hint: 'Someone clicks a button that notifies you.' },
  { kind: 'automation', label: 'Automations', hint: 'An automation notifies you. Off by default.' },
  {
    kind: 'account',
    label: 'Account requests and approvals',
    hint: 'Someone asks to join, or your own request is approved.',
  },
  { kind: 'inbox', label: 'Inbox messages', hint: 'New Inbox messages and replies to yours.' },
];

export const STATUS_TEXT: Record<Exclude<PushDeviceState, 'off' | 'on'>, string> = {
  unsupported: "This browser can't receive push notifications.",
  'ios-install':
    'To get push notifications on iPhone, install Atrium first: tap Share, then Add to Home Screen. Then open Atrium from your Home Screen and come back here.',
  'not-configured': 'Push notifications are not set up yet.',
  blocked:
    "Notifications are blocked for Atrium in this browser. Allow them in the browser's site settings (the icon next to the address), then reload this page.",
};

/** Loads the device state and exposes the two click handlers. */
export function usePushDevice(
  uid: string | undefined,
  ensureDefaultPrefs: () => Promise<void>,
  deps: PushDeps = realPushDeps,
) {
  const [state, setState] = useState<PushDeviceState | null>(null);
  const [busy, setBusy] = useState(false);
  const ensureRef = useRef(ensureDefaultPrefs);
  useEffect(() => {
    ensureRef.current = ensureDefaultPrefs;
  });

  const refresh = useCallback(async () => {
    setState(await getPushState(deps, uid).catch(() => 'unsupported' as const));
  }, [deps, uid]);

  useEffect(() => {
    let cancelled = false;
    getPushState(deps, uid)
      .catch(() => 'unsupported' as const)
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [deps, uid]);

  const enable = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    try {
      const result = await enablePush(deps, uid, () => ensureRef.current());
      if (result === 'dismissed') showToast('Push notifications were not turned on.');
    } catch {
      showToast('Could not turn on push notifications on this device.', { type: 'negative' });
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [deps, refresh, uid]);

  const disable = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    try {
      await disablePush(deps, uid);
    } catch {
      showToast('Could not turn off push notifications on this device.', { type: 'negative' });
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [deps, refresh, uid]);

  return { state, busy, enable, disable };
}
