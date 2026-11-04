import { useMemo } from 'react';
import { refs } from './firestore';
import type { TemplateDoc } from './model';
import { useQuerySnapshot, type SnapshotState } from './useSnapshot';

/**
 * Templates saved in a workspace (live), newest first. Any workspace member can read them; only
 * members who can create boards can save one. Built-in templates are code: `BUILT_IN_TEMPLATES` in
 * `@atrium/shared`.
 */
export function useTemplates(workspaceId: string | undefined): SnapshotState<TemplateDoc[]> {
  const ref = useMemo(() => (workspaceId ? refs.templates(workspaceId) : null), [workspaceId]);
  const state = useQuerySnapshot(ref);
  const sorted = useMemo(
    () => [...state.data].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
    [state.data],
  );
  return { ...state, data: sorted };
}
