import { useMemo } from 'react';
import { queries } from './firestore';
import type { ApiTokenDoc } from './model';
import { useQuerySnapshot, type SnapshotState } from './useSnapshot';

/** Newest token first. */
export function sortApiTokens(tokens: readonly ApiTokenDoc[]): ApiTokenDoc[] {
  return [...tokens].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

/** The person's live personal access tokens (revoked ones are filtered out by the query), newest first. */
export function useApiTokens(uid: string | null | undefined): SnapshotState<ApiTokenDoc[]> {
  const q = useMemo(() => (uid ? queries.liveApiTokens(uid) : null), [uid]);
  const state = useQuerySnapshot(q);
  const sorted = useMemo(() => sortApiTokens(state.data), [state.data]);
  return { ...state, data: sorted };
}
