/**
 * "Export to CSV": turns the rows a board view shows into CSV cells, and downloads the file.
 * Cell text comes from the column registry (`toText`), derived columns use the same computed value
 * the table shows, and people columns export display names.
 */
import {
  CSV_BOM,
  buildCsv,
  buildXlsxParts,
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
  /**
   * Also mark date and checkbox cells (`{ text, date }`, `{ text, checkbox }`) for the Excel
   * writer. Off by default: the CSV rows then hold plain text for those, as before.
   */
  typed?: boolean;
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
  typed: boolean,
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
  if (def.type === 'numbers' || typeof raw === 'number') return { text, numeric: true };
  if (typed && def.type === 'date') return { text, date: true };
  if (typed && def.type === 'checkbox') return { text, checkbox: true };
  return text;
}

/**
 * Header plus one row per exported item. First columns: "Item", "Group" and (when the board has
 * subitems) "Parent item", then the visible board columns in view order. Subitem rows follow
 * their parent, leave Group empty and name the parent.
 */
export function buildBoardCsvRows(input: BoardCsvInput): CsvCell[][] {
  const { board, columns, hiddenColumnIds, groups, personNames } = input;
  const typed = input.typed === true;
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
      row.push(cellFor(v, columns, item, board.id, personNames, itemNames, typed));
    }
    rows.push(row);

    for (const sub of byParent.get(item.id) ?? []) {
      const subRow: CsvCell[] = [sub.name, ''];
      if (hasSubitems) subRow.push(item.name);
      for (const v of views) {
        const own = subitemViews.get(v.def.id);
        subRow.push(
          own && own.def.type === v.def.type
            ? cellFor(own, subitemColumns, sub, board.id, personNames, itemNames, typed)
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Zips the workbook parts of `buildXlsxParts` into an `.xlsx` file. `fflate` is imported here, at
 * click time, so it stays out of the main bundle.
 */
export async function boardXlsxBytes(rows: readonly (readonly CsvCell[])[]): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const [name, xml] of Object.entries(buildXlsxParts(rows))) files[name] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

/** Starts a browser download of `csv` as `fileName` through a temporary `<a download>`. */
export function downloadCsv(fileName: string, csv: string): void {
  downloadBlob(fileName, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

/** Starts a browser download of the `.xlsx` bytes as `fileName`. */
export function downloadXlsx(fileName: string, bytes: Uint8Array): void {
  downloadBlob(fileName, new Blob([bytes as BlobPart], { type: XLSX_MIME }));
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
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
