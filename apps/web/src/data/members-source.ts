import type { MemberDoc } from './model';

/**
 * Opens the live listener behind the members store. The Firestore module is loaded on first use, so
 * code that only reads the store (and its unit tests) never pulls Firebase in.
 */
export function subscribeToMembers(
  workspaceId: string,
  onData: (members: MemberDoc[]) => void,
  onError: (error: Error) => void,
): () => void {
  let cancelled = false;
  let unsubscribe: () => void = () => undefined;
  import('./members-firestore').then(
    ({ listenToMembers }) => {
      if (!cancelled) unsubscribe = listenToMembers(workspaceId, onData, onError);
    },
    (error: unknown) => onError(error instanceof Error ? error : new Error(String(error))),
  );
  return () => {
    cancelled = true;
    unsubscribe();
  };
}
