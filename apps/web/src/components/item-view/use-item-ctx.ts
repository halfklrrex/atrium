import type { BoardRole, ColumnDef } from '@atrium/shared';
import { useEffect, useMemo, useRef } from 'react';
import type { BoardDoc, ItemDoc } from '../../data';
import type { TableCtx } from '../board-table/table-actions';

/**
 * The table action context of one board for the item view and the side panel: the same shape
 * `BoardTable` builds (with `board` for the column locks and `boardRole`), plus the context of the
 * subitem columns. `getItems` and `getGroups` read refs, so the context stays stable while items
 * change.
 */
export function useItemTableCtx({
  board,
  uid,
  items,
  boardRole,
}: {
  board: BoardDoc;
  uid: string;
  items: readonly ItemDoc[];
  boardRole: BoardRole | null;
}): { ctx: TableCtx; subCtx: TableCtx } {
  const boardId = board.id;
  const itemsRef = useRef(items);
  const groupsRef = useRef(board.groups);
  useEffect(() => {
    itemsRef.current = items;
    groupsRef.current = board.groups;
  });
  const columns: readonly ColumnDef[] = board.columns;
  const subitemColumns = board.subitemColumns;
  const columnLocks = board.columnLocks;
  const boardLocks = useMemo(() => ({ columnLocks: columnLocks ?? [] }), [columnLocks]);
  const ctx = useMemo<TableCtx>(
    () => ({
      boardId,
      uid,
      columns,
      subitemColumns: subitemColumns ?? [],
      board: boardLocks,
      boardRole,
      requiredColumnIds: board.requiredColumnIds,
      getItems: () => itemsRef.current,
      getGroups: () => groupsRef.current,
    }),
    [boardId, uid, columns, subitemColumns, boardLocks, boardRole, board.requiredColumnIds],
  );
  const subCtx = useMemo<TableCtx>(
    () => ({ ...ctx, columns: subitemColumns ?? [], scope: 'subitems' }),
    [ctx, subitemColumns],
  );
  return { ctx, subCtx };
}
