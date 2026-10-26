import { onSnapshot } from 'firebase/firestore';
import { refs } from './firestore';
import type { MemberDoc } from './model';

/**
 * The one place that opens the Firestore listener behind the members store. Kept separate so the
 * store can be unit tested without Firebase.
 */
export function listenToMembers(
  workspaceId: string,
  onData: (members: MemberDoc[]) => void,
  onError: (error: Error) => void,
): () => void {
  try {
    return onSnapshot(
      refs.members(workspaceId),
      (snap) => onData(snap.docs.map((d) => d.data())),
      onError,
    );
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
    return () => undefined;
  }
}
