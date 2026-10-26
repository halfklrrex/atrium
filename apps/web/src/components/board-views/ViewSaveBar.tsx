import { Button } from '@vibe/core';
import { useFilterStore, useViewDirty } from '../board-filters';
import { useBoardViewsContext } from './view-context';

/**
 * monday's "Save to this view" and "Discard changes", shown in the toolbar while the shown view has
 * unsaved filter, sort, group-by or Hide changes. Who may save follows `viewPermissions`; everybody
 * may discard (a viewer's changes on a shared view only ever live in this session).
 */
export function ViewSaveBar() {
  const ctx = useBoardViewsContext();
  const dirty = useViewDirty(ctx?.actions.boardId);
  if (!ctx || !dirty) return null;
  return (
    <>
      {ctx.permissions.canSave ? (
        <Button size="small" onClick={() => void ctx.save()}>
          Save to this view
        </Button>
      ) : null}
      <Button
        kind="tertiary"
        size="small"
        onClick={() => useFilterStore.getState().discardChanges(ctx.actions.boardId)}
      >
        Discard changes
      </Button>
    </>
  );
}
