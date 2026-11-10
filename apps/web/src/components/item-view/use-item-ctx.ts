import {
  columnsForSubitems,
  hasLegacySubitemColumns,
  type BoardRole,
  type ColumnDef,
} from '@atrium/shared';
import { useEffect, useMemo, useRef } from 'react';
import type { BoardDoc, ItemDoc } from '../../data';
import type { TableCtx } from '../board-table/table-actions';

/**
 * The table action context of one board for the item view and the side panel: the same shape
 * `BoardTable` builds (with `board` for the column locks and `boardRole`), plus the context of the
 * subitems' columns (the board's own, except on a board not yet migrated). `getItems` and `getGroups` read refs, so the context stays stable while items
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
  const subColumns: readonly ColumnDef[] = columnsForSubitems(board);
  const legacy = hasLegacySubitemColumns(board);
  const columnLocks = board.columnLocks;
  const boardLocks = useMemo(() => ({ columnLocks: columnLocks ?? [] }), [columnLocks]);
  const ctx = useMemo<TableCtx>(
    () => ({
      boardId,
      uid,
      columns,
      subColumns,
      board: boardLocks,
      boardRole,
      requiredColumnIds: board.requiredColumnIds,
      getItems: () => itemsRef.current,
      getGroups: () => groupsRef.current,
    }),
    [boardId, uid, columns, subColumns, boardLocks, boardRole, board.requiredColumnIds],
  );
  const subCtx = useMemo<TableCtx>(
    () => (legacy ? { ...ctx, columns: subColumns, scope: 'subitems' } : ctx),
    [ctx, subColumns, legacy],
  );
  return { ctx, subCtx };
}
