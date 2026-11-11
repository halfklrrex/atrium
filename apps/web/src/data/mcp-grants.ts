import { useMemo } from 'react';
import { queries } from './firestore';
import type { McpGrantDoc } from './model';
import { useQuerySnapshot, type SnapshotState } from './useSnapshot';

/** Newest connection first. */
export function sortMcpGrants(grants: readonly McpGrantDoc[]): McpGrantDoc[] {
  return [...grants].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

/** The person's live connected apps (revoked ones are filtered out by the query), newest first. */
export function useMcpGrants(uid: string | null | undefined): SnapshotState<McpGrantDoc[]> {
  const q = useMemo(() => (uid ? queries.liveMcpGrants(uid) : null), [uid]);
  const state = useQuerySnapshot(q);
  const sorted = useMemo(() => sortMcpGrants(state.data), [state.data]);
  return { ...state, data: sorted };
}
