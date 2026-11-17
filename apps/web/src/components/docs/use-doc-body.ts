import { useCallback, useEffect, useRef, useState } from 'react';
import { DocTooLongError, docWrites, isRevConflict, useDocBodySnapshot } from '../../data/docs';
import type { DescriptionValue } from '../item-view/description';
import { showToast } from '../toast-store';

export const DOC_CHANGED_MESSAGE = 'This doc changed. Reload to see the latest version.';

type Plain = Record<string, unknown>;

/**
 * The body of a doc as the editor needs it: the starting content (`ready` once the first snapshot
 * arrived), content that someone else saved while the user had no unsaved edits (`external`), and
 * the save and edit callbacks. Saves are revision-checked: `baseRev` is the rev the editor content
 * is based on and every save writes `baseRev + 1`; the rules refuse anything else. A refused save
 * stops autosaving and shows a toast (the banner with "Load their version" comes in a later PR).
 */
export function useDocBody(docId: string) {
  const snap = useDocBodySnapshot(docId);
  const data = snap.data;
  const loading = snap.loading;
  // `baseRev` and `dirty` are state (the render below compares them with the snapshot) mirrored in
  // refs (the save callback needs the latest values synchronously).
  const [baseRev, setBaseRevState] = useState(0);
  const [dirty, setDirtyState] = useState(false);
  const baseRevRef = useRef(0);
  const dirtyRef = useRef(false);
  const blocked = useRef(false);
  const setBaseRev = useCallback((rev: number) => {
    baseRevRef.current = rev;
    setBaseRevState(rev);
  }, []);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  }, []);
  useEffect(() => {
    baseRevRef.current = baseRev;
    dirtyRef.current = dirty;
  }, [baseRev, dirty]);
  const [initial, setInitial] = useState<{ doc: Plain | null } | null>(null);
  const [external, setExternal] = useState<{ key: number; doc: Plain | null }>({
    key: 0,
    doc: null,
  });

  // The first snapshot is the editor's starting content; a later one with a newer rev, while the
  // user has no unsaved edits, replaces the text. (State set while rendering, from state and the
  // snapshot only.)
  if (!loading) {
    if (initial === null) {
      setInitial({ doc: (data?.doc as Plain | undefined) ?? null });
      setBaseRevState(data?.rev ?? 0);
    } else if (data && data.rev > baseRev && !dirty) {
      setBaseRevState(data.rev);
      setExternal((current) => ({ key: current.key + 1, doc: data.doc as Plain }));
    }
  }

  const onEdit = useCallback(() => setDirty(true), [setDirty]);

  const save = useCallback(
    async (value: DescriptionValue | null) => {
      if (!value) return;
      if (blocked.current) {
        showToast(DOC_CHANGED_MESSAGE, { type: 'negative' });
        return;
      }
      const from = baseRevRef.current;
      setDirty(false);
      // Optimistic: our own write echoes back through the snapshot with this rev and must not
      // look like somebody else's save.
      setBaseRev(from + 1);
      try {
        await docWrites.saveBody(docId, { doc: value.doc as never, text: value.text }, from);
      } catch (error) {
        setBaseRev(from);
        setDirty(true);
        if (error instanceof DocTooLongError) {
          showToast(error.message, { type: 'negative' });
        } else if (isRevConflict(error)) {
          blocked.current = true;
          showToast(DOC_CHANGED_MESSAGE, { type: 'negative' });
        } else {
          showToast('Could not save the doc. Try again.', { type: 'negative' });
        }
        throw error;
      }
    },
    [docId, setBaseRev, setDirty],
  );

  const meta = data ? { updatedBy: data.updatedBy, updatedAt: data.updatedAt } : null;
  return { ready: initial !== null, initial: initial?.doc ?? null, external, meta, onEdit, save };
}
