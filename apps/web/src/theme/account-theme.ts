import type { ThemePreference } from '@atrium/shared';
import { useEffect, useRef } from 'react';
import { showToast } from '../components/toast-store';
import { useMyUserDoc, userWrites } from '../data/user-settings';
import { useThemeStore } from './theme';

/** localStorage flag per account: this device has already offered its theme to the account. */
export const adoptedKey = (uid: string) => `atrium.themeAdopted.${uid}`;

function readFlag(uid: string): boolean {
  try {
    return localStorage.getItem(adoptedKey(uid)) !== null;
  } catch {
    return false;
  }
}

function writeFlag(uid: string): void {
  try {
    localStorage.setItem(adoptedKey(uid), '1');
  } catch {
    // Private mode: the in-session guard below still prevents a loop.
  }
}

export const THEME_SAVE_ERROR = "Couldn't save your theme to your account.";

/**
 * Keeps the theme in step with `users/{uid}.theme` (mounted once for signed-in sessions).
 * The account is the source, the browser store the device cache:
 * - first snapshot: the account wins, except the one-time adoption (account still `system`, this
 *   device holds a non-system choice and has not adopted yet: push it to the account instead);
 * - later snapshots that change `theme` (another device) apply here;
 * - a local change writes `{ theme }` once, and a refused write keeps the local choice.
 */
export function useAccountThemeSync(uid: string | undefined): void {
  const { data: doc } = useMyUserDoc(uid);
  const accountTheme = doc?.theme;

  /** The last theme known to be on the account (or being written to it). */
  const known = useRef<ThemePreference | null>(null);
  const inFlight = useRef(0);
  const ready = useRef(false);
  const adoptionTried = useRef<string | null>(null);

  const save = (id: string, theme: ThemePreference) => {
    const previous = known.current;
    known.current = theme;
    inFlight.current += 1;
    userWrites
      .setTheme(id, theme)
      .catch(() => {
        // The local choice stays; the account keeps its old value.
        known.current = previous;
        showToast(THEME_SAVE_ERROR, { type: 'negative' });
      })
      .finally(() => {
        inFlight.current -= 1;
      });
  };

  // A different account on the same page load starts from scratch.
  useEffect(() => {
    ready.current = false;
    known.current = null;
    inFlight.current = 0;
  }, [uid]);

  // Account -> device.
  useEffect(() => {
    if (!uid || !accountTheme) return;
    const store = useThemeStore.getState();
    if (!ready.current) {
      ready.current = true;
      known.current = accountTheme;
      const adopt =
        accountTheme === 'system' &&
        store.preference !== 'system' &&
        !readFlag(uid) &&
        adoptionTried.current !== uid;
      // From now on this device has had its one chance, whatever happens to the write.
      writeFlag(uid);
      if (adopt) {
        adoptionTried.current = uid;
        save(uid, store.preference);
      } else if (store.preference !== accountTheme) {
        store.setPreference(accountTheme);
      }
      return;
    }
    // A snapshot while our own write is in flight (optimistic value or rollback) is not news.
    if (inFlight.current > 0 || accountTheme === known.current) return;
    known.current = accountTheme;
    if (store.preference !== accountTheme) store.setPreference(accountTheme);
  }, [uid, accountTheme]);

  // Device -> account.
  useEffect(() => {
    if (!uid) return;
    return useThemeStore.subscribe((state, previous) => {
      if (!ready.current || state.preference === previous.preference) return;
      if (state.preference === known.current) return;
      save(uid, state.preference);
    });
  }, [uid]);
}
