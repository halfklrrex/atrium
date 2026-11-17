import type { TeamDoc } from './model';

/**
 * Opens the live listener behind the teams store. The Firestore module loads on first use, so code
 * that only reads the store (and its unit tests) never pulls Firebase in.
 */
export function subscribeToTeams(
  workspaceId: string,
  onData: (teams: TeamDoc[]) => void,
  onError: (error: Error) => void,
): () => void {
  let cancelled = false;
  let unsubscribe: () => void = () => undefined;
  import('./teams-firestore').then(
    ({ listenToTeams }) => {
      if (!cancelled) unsubscribe = listenToTeams(workspaceId, onData, onError);
    },
    (error: unknown) => onError(error instanceof Error ? error : new Error(String(error))),
  );
  return () => {
    cancelled = true;
    unsubscribe();
  };
}
