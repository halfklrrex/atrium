import type { AccountStatus } from '@atrium/shared';
import { Text } from '@vibe/core';
import { onSnapshot } from 'firebase/firestore';
import { useEffect, useRef } from 'react';
import { FullPageMessage } from '../components/FullPage';
import { plainRefs } from '../data/firestore';
import { AppealPanel } from './AppealPanel';
import { useAuth } from './auth-context';

/** After a refresh that never saw the new claim: wait this long, then try again, at most this often. */
const REFRESH_RETRY_DELAY_MS = 5000;
const REFRESH_RETRY_COUNT = 5;

/** Shown on the blocked screen above the appeal panel (ADMIN-4 PR6). */
export const BLOCKED_SCREEN_MESSAGE =
  "An admin has blocked this account, so you can't use Atrium with it. If you think this is a mistake, you can send an appeal below.";

/**
 * Full-page screen for an account that is not approved (ADMIN-3). It renders no app shell and starts
 * no workspace or board subscriptions. A pending person waits here, and a blocked person sees why they
 * are locked out: either way the screen listens to their own `users/{uid}` document and, once an
 * admin approves (or unblocks), refreshes the ID token (the new claim only applies after that) and
 * continues into the app without a page reload.
 */
export function AccountGate({ status }: { status: Extract<AccountStatus, 'pending' | 'blocked'> }) {
  const { user, signOut, refreshAccount } = useAuth();
  const uid = user?.uid;
  const name = user?.displayName ?? user?.email ?? 'your account';
  const refreshing = useRef(false);

  useEffect(() => {
    if (!uid) return;
    refreshing.current = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // `refreshAccount` throws when the new claim has not arrived. No new snapshot follows a missed
    // claim, so try again on a timer, a bounded number of times.
    const refresh = () => {
      timer = undefined;
      refreshing.current = true;
      refreshAccount().catch((e: unknown) => {
        refreshing.current = false;
        console.warn('Could not refresh the session after the account was approved', e);
        if (retries < REFRESH_RETRY_COUNT) {
          retries += 1;
          timer = setTimeout(refresh, REFRESH_RETRY_DELAY_MS);
        }
      });
    };
    const unsubscribe = onSnapshot(
      plainRefs.user(uid),
      (snap) => {
        // Pending: approved by an admin. Blocked: unblocked by an admin (ADMIN-4). Either way the
        // new claim only applies after a token refresh.
        if (snap.data()?.accountStatus !== 'approved' || refreshing.current) return;
        if (timer !== undefined) clearTimeout(timer);
        refresh();
      },
      // The document may not be readable yet; waiting on the screen is the right outcome.
      () => {},
    );
    return () => {
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [status, uid, refreshAccount]);

  const signOutAction = { text: 'Sign out', onClick: () => void signOut() };

  if (status === 'blocked') {
    return (
      <FullPageMessage
        title="Your account is blocked"
        description={BLOCKED_SCREEN_MESSAGE}
        primary={signOutAction}
        wide
      >
        {uid ? <AppealPanel uid={uid} /> : null}
        <Text type="text2" color="secondary">
          Signed in as {name}
        </Text>
      </FullPageMessage>
    );
  }
  return (
    <FullPageMessage
      title="Waiting for approval"
      description="An admin needs to approve your account. You'll get in as soon as they do."
      primary={signOutAction}
    >
      <Text type="text2" color="secondary">
        Signed in as {name}
      </Text>
    </FullPageMessage>
  );
}
