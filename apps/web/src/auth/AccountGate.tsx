import type { AccountStatus } from '@atrium/shared';
import { Text } from '@vibe/core';
import { onSnapshot } from 'firebase/firestore';
import { useEffect, useRef } from 'react';
import { FullPageMessage } from '../components/FullPage';
import { plainRefs } from '../data/firestore';
import { useAuth } from './auth-context';
import { ACCOUNT_DISABLED_MESSAGE } from './auth-errors';

/**
 * Full-page screen for an account that is not approved (ADMIN-3). It renders no app shell and starts
 * no workspace or board subscriptions. A pending person waits here: the screen listens to their own
 * `users/{uid}` document and, once an admin approves, refreshes the ID token (the new claim only
 * applies after that) and continues into the app without a page reload.
 */
export function AccountGate({ status }: { status: Extract<AccountStatus, 'pending' | 'blocked'> }) {
  const { user, signOut, refreshAccount } = useAuth();
  const uid = user?.uid;
  const name = user?.displayName ?? user?.email ?? 'your account';
  const refreshing = useRef(false);

  useEffect(() => {
    if (status !== 'pending' || !uid) return;
    refreshing.current = false;
    return onSnapshot(
      plainRefs.user(uid),
      (snap) => {
        if (snap.data()?.accountStatus !== 'approved' || refreshing.current) return;
        refreshing.current = true;
        refreshAccount().catch((e: unknown) => {
          refreshing.current = false;
          console.warn('Could not refresh the session after approval', e);
        });
      },
      // The document may not be readable yet; waiting on the screen is the right outcome.
      () => {},
    );
  }, [status, uid, refreshAccount]);

  const signOutAction = { text: 'Sign out', onClick: () => void signOut() };

  if (status === 'blocked') {
    return (
      <FullPageMessage
        title="Your account is blocked"
        description={ACCOUNT_DISABLED_MESSAGE}
        primary={signOutAction}
      />
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
