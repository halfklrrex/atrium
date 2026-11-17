import { useCallback, useEffect, useRef, useState } from 'react';
import { DocTooLongError, docWrites, isRevConflict, useDocBodySnapshot } from '../../data/docs';
import type { DescriptionValue } from '../item-view/description';
import { showToast } from '../toast-store';

export const DOC_DENIED_MESSAGE =
  "You can't save changes to this doc anymore. Copy your text if you need it.";

type Plain = Record<string, unknown>;

/** Somebody else's newer version of the doc, offered by the conflict banner. */
export interface DocConflict {
  rev: number;
  doc: Plain;
  updatedBy: string | null;
}

/** Thrown by `save` while the conflict banner is up: nothing is written. */
export class DocConflictError extends Error {
  constructor() {
    super('This doc changed while you were editing.');
    this.name = 'DocConflictError';
  }
}

/**
 * The body of a doc as the editor needs it: the starting content (`ready` once the first snapshot
 * arrived), content that someone else saved while the user had no unsaved edits (`external`), and
 * the save and edit callbacks.
 *
 * Saves are revision-checked: `baseRev` is the rev the editor content is based on and every save
 * writes `baseRev + 1`; the rules refuse anything else, so nobody overwrites anybody silently.
 * There are two ways into a conflict, and both stop autosaving and surface `conflict`:
 *  1. A snapshot with a newer rev arrives while the user has unsaved edits.
 *  2. A save is refused. A refusal is only called a conflict after re-reading the body from the
 *     server and finding a rev newer than the one the save was based on; any other refusal (a lost
 *     role, a trashed doc) stays an error, because "Load their version" would be a lie.
 * `loadTheirs` and `keepMine` resolve it; nothing is ever merged automatically.
 */
export function useDocBody(docId: string) {
  const snap = useDocBodySnapshot(docId);
  const data = snap.data;
  const loading = snap.loading;
  // `baseRev`, `dirty` and `conflict` are state (the render below compares them with the
  // snapshot) mirrored in refs (the callbacks need the latest values synchronously).
  const [baseRev, setBaseRevState] = useState(0);
  const [dirty, setDirtyState] = useState(false);
  const [conflict, setConflictState] = useState<DocConflict | null>(null);
  const baseRevRef = useRef(0);
  const dirtyRef = useRef(false);
  const conflictRef = useRef<DocConflict | null>(null);
  const deniedRef = useRef(false);
  const latestRev = useRef(0);
  const setBaseRev = useCallback((rev: number) => {
    baseRevRef.current = rev;
    setBaseRevState(rev);
  }, []);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  }, []);
  const setConflict = useCallback((value: DocConflict | null) => {
    conflictRef.current = value;
    setConflictState(value);
  }, []);
  useEffect(() => {
    baseRevRef.current = baseRev;
    dirtyRef.current = dirty;
    conflictRef.current = conflict;
    latestRev.current = data?.rev ?? 0;
  }, [baseRev, dirty, conflict, data]);
  const [initial, setInitial] = useState<{ doc: Plain | null } | null>(null);
  const [external, setExternal] = useState<{ key: number; doc: Plain | null }>({
    key: 0,
    doc: null,
  });

  // The first snapshot is the editor's starting content. A later one with a newer rev replaces the
  // text when the user has no unsaved edits, and becomes a conflict when they do. (State set
  // while rendering, from state and the snapshot only.)
  if (!loading) {
    if (initial === null) {
      setInitial({ doc: (data?.doc as Plain | undefined) ?? null });
      setBaseRevState(data?.rev ?? 0);
    } else if (data && data.rev > baseRev) {
      if (!dirty) {
        setBaseRevState(data.rev);
        setExternal((current) => ({ key: current.key + 1, doc: data.doc as Plain }));
        if (conflict) setConflictState(null);
      } else if (conflict?.rev !== data.rev) {
        setConflictState({
          rev: data.rev,
          doc: data.doc as Plain,
          updatedBy: data.updatedBy ?? null,
        });
      }
    }
  }

  const onEdit = useCallback(() => setDirty(true), [setDirty]);

  /** After a refused write: decide between "somebody else saved" and "you can't write here". */
  const handleRefusal = useCallback(
    async (error: unknown, from: number) => {
      if (error instanceof DocTooLongError) {
        showToast(error.message, { type: 'negative' });
        return;
      }
      if (!isRevConflict(error)) {
        showToast('Could not save the doc. Try again.', { type: 'negative' });
        return;
      }
      let stored: Awaited<ReturnType<typeof docWrites.readBodyFromServer>>;
      try {
        stored = await docWrites.readBodyFromServer(docId);
      } catch (readError) {
        if (isRevConflict(readError)) {
          deniedRef.current = true;
          showToast(DOC_DENIED_MESSAGE, { type: 'negative' });
        } else {
          showToast('Could not save the doc. Try again.', { type: 'negative' });
        }
        return;
      }
      if (stored && stored.rev > from) {
        setConflict({
          rev: stored.rev,
          doc: stored.doc as Plain,
          updatedBy: stored.updatedBy ?? null,
        });
      } else {
        // Refused although nobody saved a newer revision: the rules said no for another reason.
        deniedRef.current = true;
        showToast(DOC_DENIED_MESSAGE, { type: 'negative' });
      }
    },
    [docId, setConflict],
  );

  const write = useCallback(
    async (value: DescriptionValue, from: number) => {
      setDirty(false);
      // Optimistic: our own write echoes back through the snapshot with this rev and must not
      // look like somebody else's save.
      setBaseRev(from + 1);
      try {
        await docWrites.saveBody(docId, { doc: value.doc as never, text: value.text }, from);
      } catch (error) {
        setBaseRev(from);
        setDirty(true);
        await handleRefusal(error, from);
        throw error;
      }
    },
    [docId, handleRefusal, setBaseRev, setDirty],
  );

  const save = useCallback(
    async (value: DescriptionValue | null) => {
      if (!value) return;
      if (deniedRef.current) {
        showToast(DOC_DENIED_MESSAGE, { type: 'negative' });
        throw new Error('denied');
      }
      // A newer revision may be on its way into state; never write over it.
      if (conflictRef.current || latestRev.current > baseRevRef.current) {
        if (!conflictRef.current) setDirty(true);
        throw new DocConflictError();
      }
      await write(value, baseRevRef.current);
    },
    [setDirty, write],
  );

  /** Discard my unsaved edits and show their version. */
  const loadTheirs = useCallback(() => {
    const theirs = conflictRef.current;
    if (!theirs) return;
    setConflict(null);
    setDirty(false);
    setBaseRev(theirs.rev);
    setExternal((current) => ({ key: current.key + 1, doc: theirs.doc }));
  }, [setBaseRev, setConflict, setDirty]);

  /** Save my content on top of their revision (their changes are overwritten). */
  const keepMine = useCallback(
    async (value: DescriptionValue) => {
      const theirs = conflictRef.current;
      if (!theirs) return;
      setConflict(null);
      try {
        await write(value, theirs.rev);
      } catch {
        // `write` already reported: a newer conflict is back on screen, or a toast explained.
      }
    },
    [setConflict, write],
  );

  const meta = data ? { updatedBy: data.updatedBy, updatedAt: data.updatedAt } : null;
  return {
    ready: initial !== null,
    initial: initial?.doc ?? null,
    external,
    meta,
    conflict,
    onEdit,
    save,
    loadTheirs,
    keepMine,
  };
}
