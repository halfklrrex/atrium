import { MAIN_VIEW_ID } from '@atrium/shared';

/** The slice of a view the permission checks read. */
export interface ViewLike {
  id: string;
  ownerId: string | null;
}

export interface ViewPermissions {
  /** "Save to this view" (filters, sort, group-by, Hide). */
  canSave: boolean;
  canRename: boolean;
  /** Duplicate is open to everybody: a viewer gets a personal copy. */
  canDuplicate: boolean;
  canDelete: boolean;
  /** Turn a shared view personal (editors) or a personal view shared (owner who can edit). */
  canChangeScope: boolean;
}

/**
 * What the signed-in user may do with a view tab. `canEdit` is the board edit right (editor or
 * owner). Shared views follow it; a personal view belongs to its owner, who may even be a viewer.
 * `main` is shared, never renamed, deleted or turned personal.
 */
export function viewPermissions(view: ViewLike, uid: string, canEdit: boolean): ViewPermissions {
  const isMain = view.id === MAIN_VIEW_ID;
  const shared = view.ownerId === null;
  const own = view.ownerId === uid;
  const mayWrite = shared ? canEdit : own;
  return {
    canSave: mayWrite,
    canRename: !isMain && mayWrite,
    canDuplicate: true,
    canDelete: !isMain && mayWrite,
    // Both directions write a shared view (the copy or the original), which needs board edit rights.
    canChangeScope: !isMain && mayWrite && canEdit,
  };
}

/** Owner of a view created by `uid`: shared when they may edit the board, personal otherwise. */
export function newViewOwner(uid: string, canEdit: boolean): string | null {
  return canEdit ? null : uid;
}
