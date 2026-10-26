import type { GroupDef } from '@atrium/shared';
import { createContext, useContext } from 'react';
import type { ItemDoc } from '../../data';
import type { TableCtx } from './table-actions';
import type { ColumnView, GroupModel } from './table-model';

/** Board-wide values every row and header needs. It only changes when the structure does. */
export interface TableEnv {
  boardId: string;
  uid: string;
  /** Can this person edit cells and structure (editor or owner on the board)? */
  canEdit: boolean;
  /** Columns this view shows (Hide applied). */
  columns: ColumnView[];
  /** Every board column, hidden ones included (position maths and reordering); `columns` when unset. */
  allColumns?: ColumnView[];
  /** `board.subitemColumns` ready to render; `[]` until the board's first subitem. */
  subitemColumns: ColumnView[];
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
