import { updateDoc } from 'firebase/firestore';
import { useMemo } from 'react';
import { plainRefs, refs } from './firestore';
import { useDocSnapshot } from './useSnapshot';

/** The signed-in person's own `users/{uid}` document (null while loading or when absent). */
export function useMyUserDoc(uid: string | undefined) {
  const ref = useMemo(() => (uid ? refs.user(uid) : null), [uid]);
  return useDocSnapshot(ref);
}

export const userWrites = {
  /** Field write on the person's own document; the rules accept `timezone` (at most 64 characters). */
  async setTimezone(uid: string, timezone: string): Promise<void> {
    await updateDoc(plainRefs.user(uid), { timezone });
  },
};
