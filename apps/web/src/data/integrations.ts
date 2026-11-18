import { useMemo } from 'react';
import { refs } from './firestore';
import type { IncomingHookDoc, WebhookDoc } from './model';
import { useQuerySnapshot, type SnapshotState } from './useSnapshot';

/** Oldest first, so a new hook lands at the bottom of the list. */
function byCreated<T extends { createdAt: { toMillis: () => number } }>(docs: readonly T[]): T[] {
  return [...docs].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
}

/** The board's outgoing webhooks (board owners only; the rules refuse everyone else). */
export function useBoardWebhooks(boardId: string | null | undefined): SnapshotState<WebhookDoc[]> {
  const q = useMemo(() => (boardId ? refs.webhooks(boardId) : null), [boardId]);
  const state = useQuerySnapshot(q);
  const sorted = useMemo(() => byCreated(state.data), [state.data]);
  return { ...state, data: sorted };
}

/** The board's incoming webhooks (board owners only). Never carries a URL or secret. */
export function useBoardIncomingHooks(
  boardId: string | null | undefined,
): SnapshotState<IncomingHookDoc[]> {
  const q = useMemo(() => (boardId ? refs.incomingHooks(boardId) : null), [boardId]);
  const state = useQuerySnapshot(q);
  const sorted = useMemo(() => byCreated(state.data), [state.data]);
  return { ...state, data: sorted };
}
