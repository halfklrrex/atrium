/**
 * "Export to CSV": turns the rows a board view shows into CSV cells, and downloads the file.
 * Cell text comes from the column registry (`toText`), derived columns use the same computed value
 * the table shows, and people columns export display names.
 */
import {
  CSV_BOM,
  buildBoardWorkbookParts,
  buildCsv,
  columnRegistry,
  findStatusLabel,
  type BoardWorkbookData,
  type ColumnDef,
  type CsvCell,
  type GroupDef,
  type StatusSettings,
  type StatusValue,
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
  /**
   * Export only these top-level items (the batch bar's selection), keeping `items` order. Subitems
   * of an included parent still follow it; ids that are not in `items` are ignored.
   */
  itemIds?: readonly string[];
}

const isActive = (item: ItemDoc): boolean => item.state === 'active';

/** The plain text of one cell, as the CSV writes it (Kanban card lines). */
export function exportCellText(
  view: ColumnView,
  columnDefs: readonly ColumnDef[],
  item: ItemDoc,
  boardId: string,
  personNames: (uid: string) => string | undefined,
  itemNames: ReadonlyMap<string, string>,
): string {
  const cell = cellFor(view, columnDefs, item, boardId, personNames, itemNames, false);
  return typeof cell === 'string' ? cell : cell.text;
}

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
  if (raw === null || raw === undefined) {
    // An empty status cell is grey in the table, and in the workbook.
    return typed && def.type === 'status' ? { text: '', color: null } : '';
  }

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
  if (typed && def.type === 'status' && typeof raw === 'object' && !Array.isArray(raw)) {
    const labels = (settings as StatusSettings | undefined)?.labels;
    const label = Array.isArray(labels)
      ? findStatusLabel(raw as StatusValue, settings as StatusSettings)
      : null;
    return { text, color: label && text !== '' ? label.color : null };
  }
  return text;
}

/** One exported row with what the workbook needs besides the cells. */
export interface ExportRow {
  cells: CsvCell[];
  item: ItemDoc;
  /** The row's group (a subitem: its parent's). */
  groupId: string;
  subitem: boolean;
}

export interface ExportTable {
  header: string[];
  hasSubitems: boolean;
  rows: ExportRow[];
}

/** Header texts made unique: a repeated title becomes "Status (2)", "Status (3)". */
export function uniqueHeaders(titles: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const key = title.trim().toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? title : `${title} (${n})`;
  });
}

/**
 * Header plus one row per exported item. First columns: "Item", "Group" and (when the board has
 * subitems) "Parent item", then the visible board columns in view order. Subitem rows follow
 * their parent, carry the parent's group and name the parent.
 */
export function buildBoardCsvRows(input: BoardCsvInput): CsvCell[][] {
  const table = buildBoardExportTable(input);
  return [table.header, ...table.rows.map((r) => r.cells)];
}

/** The rows of `buildBoardCsvRows` with the item, group and subitem flag of each row. */
export function buildBoardExportTable(input: BoardCsvInput): ExportTable {
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

  const only = input.itemIds ? new Set(input.itemIds) : null;
  const items = input.items.filter((i) => isActive(i) && (only === null || only.has(i.id)));
  const hasSubitems = activeSubitems.length > 0 || subitemColumns.length > 0;
  // Dependency cells name any active item, so the names come from the whole board, not the selection.
  const itemNames = new Map(
    [...input.items.filter(isActive), ...activeSubitems].map((i) => [i.id, i.name]),
  );

  const titles = ['Item', 'Group'];
  if (hasSubitems) titles.push('Parent item');
  for (const v of views) titles.push(v.def.title);
  const header = uniqueHeaders(titles);
  const rows: ExportRow[] = [];

  for (const item of items) {
    const group = groupTitles.get(item.groupId) ?? '';
    const row: CsvCell[] = [item.name, group];
    if (hasSubitems) row.push('');
    for (const v of views) {
      row.push(cellFor(v, columns, item, board.id, personNames, itemNames, typed));
    }
    rows.push({ cells: row, item, groupId: item.groupId, subitem: false });

    for (const sub of byParent.get(item.id) ?? []) {
      const subRow: CsvCell[] = [sub.name, group];
      if (hasSubitems) subRow.push(item.name);
      for (const v of views) {
        const own = subitemViews.get(v.def.id);
        subRow.push(
          own && own.def.type === v.def.type
            ? cellFor(own, subitemColumns, sub, board.id, personNames, itemNames, typed)
            : '',
        );
      }
      rows.push({ cells: subRow, item: sub, groupId: item.groupId, subitem: true });
    }
  }
  return { header, hasSubitems, rows };
}

/** Builds the file text (with the BOM) from rows made by `buildBoardCsvRows`. */
export function boardCsvText(rows: readonly (readonly CsvCell[])[]): string {
  return CSV_BOM + buildCsv(rows);
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Zips the parts of the designed workbook (`buildBoardWorkbookParts`) into an `.xlsx` file.
 * `fflate` is imported here, at click time, so it stays out of the main bundle.
 */
export async function boardXlsxBytes(data: BoardWorkbookData): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const [name, xml] of Object.entries(buildBoardWorkbookParts(data))) {
    files[name] = strToU8(xml);
  }
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
