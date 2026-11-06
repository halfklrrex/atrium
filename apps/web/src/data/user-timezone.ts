import { useMemo } from 'react';
import { refs } from './firestore';
import { useDocSnapshot } from './useSnapshot';

/**
 * The signed-in user's saved IANA zone (`users/{uid}.timezone`), or `null` while it loads, when it
 * is missing or empty. A scheduled recipe is saved with this zone (P5d).
 */
export function useUserTimezone(uid: string): string | null {
  const ref = useMemo(() => (uid ? refs.user(uid) : null), [uid]);
  const { data } = useDocSnapshot(ref);
  return data?.timezone?.trim() || null;
}
