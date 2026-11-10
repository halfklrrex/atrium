import type { GroupDef } from '@atrium/shared';
import { createContext, useContext } from 'react';
import type { ItemDoc } from '../../data';
import type { TableCtx } from './table-actions';
import type { ColumnView, GroupModel } from './table-model';

/** Board-wide values every row and header needs. It only changes when the structure does. */
export interface TableEnv {
  boardId: string;
  workspaceId?: string;
  /** Optional override of readable workspace boards (used by Connect Boards settings tests). */
  workspaceBoards?: readonly { id: string; name: string }[];
  uid: string;
  /** Board name, for the exported file's name. */
  boardName?: string;
  /** Display name of a user id, for the exported people cells. */
  userLookup?: (uid: string) => string | undefined;
  /** Can this person edit cells and structure (editor or owner on the board)? */
  canEdit: boolean;
  /** Is this person a board owner (can lock/unlock columns and edit locked columns)? */
  canManage?: boolean;
  /** Columns this view shows (Hide applied). */
  columns: ColumnView[];
  /** Every board column, hidden ones included (position maths and reordering); `columns` when unset. */
  allColumns?: ColumnView[];
  /**
   * The columns a subitem block renders: the view's visible `columns` (subitems share the board's
   * columns), or, on a board not yet migrated, its legacy subitem columns.
   */
  subColumns: ColumnView[];
  /** The board still has legacy subitem columns: column writes in subitem blocks go to them. */
  legacySubitems?: boolean;
  /** Set inside a subitem block (its header offers no sort, and its rows are subitems). */
  inSubitemBlock?: boolean;
  /** Groups in position order. */
  groups: GroupDef[];
  nameWidth: number;
  ctx: TableCtx;
  /** Live reads for actions that need current data without making rows re-render. */
  getModels: () => GroupModel[];
  getItems: () => ItemDoc[];
  /** The scrolling element (virtualisation and keyboard scrolling). */
  scrollElement: HTMLElement | null;
  /**
   * A header edge is being dragged: `columnId` is a column id or `NAME_COLUMN`. `final` is true on
   * release, when the width is saved; before that it only moves the grid.
   */
  onResize: (columnId: string, width: number, final: boolean) => void;
}

export const TableEnvContext = createContext<TableEnv | null>(null);

export function useTableEnv(): TableEnv {
  const env = useContext(TableEnvContext);
  if (!env) throw new Error('useTableEnv must be used inside <BoardTable>');
  return env;
}

/** First status column and whether `item` holds a "done" label in it (monday's overdue rule). */
export function isRowDone(item: ItemDoc, columns: readonly ColumnView[]): boolean {
  const status = columns.find((c) => c.def.type === 'status');
  if (!status) return false;
  const raw = item.values[status.def.id] as { index?: number; label?: string } | null | undefined;
  if (!raw) return false;
  const settings = status.settings as {
    labels: { index: number; label: string; isDone?: boolean }[];
  };
  const label =
    (raw.index !== undefined ? settings.labels.find((l) => l.index === raw.index) : undefined) ??
    settings.labels.find((l) => l.label.toLowerCase() === raw.label?.toLowerCase());
  return label?.isDone === true;
}
