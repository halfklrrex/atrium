/**
 * "Export to CSV": turns the rows a board view shows into CSV cells, and downloads the file.
 * Cell text comes from the column registry (`toText`), derived columns use the same computed value
 * the table shows, and people columns export display names.
 */
import {
  CSV_BOM,
  buildCsv,
  columnRegistry,
  type ColumnDef,
  type CsvCell,
  type GroupDef,
} from '@atrium/shared';
import type { BoardDoc, ItemDoc } from '../../data';
import { UNKNOWN_PERSON_NAME } from '../../data/members-store';
import { cellDisplayText } from '../../lib/cell-display-text';
import { derivedCellValue } from '../board-table/derived';
import { buildColumnViews, type ColumnView } from '../board-table/table-model';
import { comparePositions } from '../../lib/positions';

export interface BoardCsvInput {
  board: Pick<BoardDoc, 'id'>;
  /** Top-level items in the order to export (the view's order); archived and trashed are dropped. */
  items: readonly ItemDoc[];
  /** Subitems of the board; the ones of an exported parent follow it, in position order. */
  subitems: readonly ItemDoc[];
  /** Board columns (any order: the view's column order is their `position`). */
  columns: readonly ColumnDef[];
  /** Subitem columns, used for the cells of subitem rows whose column id and type match. */
  subitemColumns?: readonly ColumnDef[];
  /** Columns the open view hides; they are not exported. */
  hiddenColumnIds: readonly string[];
  groups: readonly GroupDef[];
  /** Display name of a user id; `undefined` when unknown. */
  personNames: (uid: string) => string | undefined;
}

const isActive = (item: ItemDoc): boolean => item.state === 'active';

/** Cell of one column for one item: the registry's text, or the computed value for a derived one. */
function cellFor(
  view: ColumnView,
  columnDefs: readonly ColumnDef[],
  item: ItemDoc,
  boardId: string,
  personNames: (uid: string) => string | undefined,
  itemNames: ReadonlyMap<string, string>,
): CsvCell {
  const { def, settings } = view;
  const raw = columnRegistry.isDerived(def.type)
    ? derivedCellValue(boardId, columnDefs, def, item)
    : item.values[def.id];
  if (raw === null || raw === undefined) return '';

  if (def.type === 'dependency') {
    const ids = (raw as { item_ids?: unknown }).item_ids;
    if (Array.isArray(ids)) {
      return ids.map((id) => itemNames.get(String(id)) ?? String(id)).join(', ');
    }
  }

  const text = cellDisplayText(def.type, raw, settings, {
    personName: personNames,
    // A team keeps the CSV's long-standing fallback (it used to go through `personNames`).
    teamName: (id) => personNames(id) ?? UNKNOWN_PERSON_NAME,
  });
  return def.type === 'numbers' || typeof raw === 'number' ? { text, numeric: true } : text;
}

/**
 * Header plus one row per exported item. First columns: "Item", "Group" and (when the board has
 * subitems) "Parent item", then the visible board columns in view order. Subitem rows follow
 * their parent, leave Group empty and name the parent.
 */
export function buildBoardCsvRows(input: BoardCsvInput): CsvCell[][] {
  const { board, columns, hiddenColumnIds, groups, personNames } = input;
  const subitemColumns = input.subitemColumns ?? [];
  const hidden = new Set(hiddenColumnIds);
  const views = buildColumnViews(columns).filter((v) => !hidden.has(v.def.id));
  const subitemViews = new Map(buildColumnViews(subitemColumns).map((v) => [v.def.id, v]));
  const groupTitles = new Map(groups.map((g) => [g.id, g.title]));

  const activeSubitems = input.subitems.filter(isActive);
  const byParent = new Map<string, ItemDoc[]>();
  for (const sub of activeSubitems) {
    if (sub.parentItemId === null || sub.parentItemId === undefined) continue;
    const list = byParent.get(sub.parentItemId);
    if (list) list.push(sub);
    else byParent.set(sub.parentItemId, [sub]);
  }
  for (const list of byParent.values()) list.sort(comparePositions);

  const items = input.items.filter(isActive);
  const hasSubitems = activeSubitems.length > 0 || subitemColumns.length > 0;
  const itemNames = new Map([...items, ...activeSubitems].map((i) => [i.id, i.name]));

  const header: CsvCell[] = ['Item', 'Group'];
  if (hasSubitems) header.push('Parent item');
  for (const v of views) header.push(v.def.title);
  const rows: CsvCell[][] = [header];

  for (const item of items) {
    const row: CsvCell[] = [item.name, groupTitles.get(item.groupId) ?? ''];
    if (hasSubitems) row.push('');
    for (const v of views) {
      row.push(cellFor(v, columns, item, board.id, personNames, itemNames));
    }
    rows.push(row);

    for (const sub of byParent.get(item.id) ?? []) {
      const subRow: CsvCell[] = [sub.name, ''];
      if (hasSubitems) subRow.push(item.name);
      for (const v of views) {
        const own = subitemViews.get(v.def.id);
        subRow.push(
          own && own.def.type === v.def.type
            ? cellFor(own, subitemColumns, sub, board.id, personNames, itemNames)
            : '',
        );
      }
      rows.push(subRow);
    }
  }
  return rows;
}

/** Builds the file text (with the BOM) from rows made by `buildBoardCsvRows`. */
export function boardCsvText(rows: readonly (readonly CsvCell[])[]): string {
  return CSV_BOM + buildCsv(rows);
}

/** Starts a browser download of `csv` as `fileName` through a temporary `<a download>`. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // The click has started the download; release the blob after the browser had a tick to read it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
