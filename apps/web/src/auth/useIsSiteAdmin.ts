import { isAdminClaims } from '@atrium/shared';
import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';

/** True when the signed-in user's ID token carries the `admin` claim; false while loading. */
export function useIsSiteAdmin(): boolean {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [result, setResult] = useState<{ uid: string; admin: boolean } | null>(null);

  useEffect(() => {
    if (!user || !uid) return;
    let cancelled = false;
    // Wrapped so a user object without the method (or a throw) just means "not an admin".
    Promise.resolve()
      .then(() => user.getIdTokenResult())
      .then(
        ({ claims }) => {
          if (!cancelled) setResult({ uid, admin: isAdminClaims(claims) });
        },
        () => {
          if (!cancelled) setResult({ uid, admin: false });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [user, uid]);

  return result !== null && result.uid === uid && result.admin;
}
