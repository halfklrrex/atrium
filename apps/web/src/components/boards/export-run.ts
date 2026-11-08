/**
 * Runs one export (CSV or Excel) with the toasts the menus share: "Exporting..." first for a large
 * export, then "Exported N items" or the error.
 */
import { csvFileName, xlsxFileName, type CsvCell } from '@atrium/shared';
import { showToast, updateToast } from '../toast-store';
import { boardCsvText, boardXlsxBytes, downloadCsv, downloadXlsx } from './board-export';

/** Above this many items the "Exporting..." toast is shown before the file is built. */
export const LARGE_EXPORT_ROWS = 5000;

export type ExportFormat = 'csv' | 'xlsx';

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function runExport(opts: {
  format: ExportFormat;
  boardName: string;
  /** Items the export starts from, to decide whether it is large. */
  itemCount: number;
  /** Builds the rows (header first); called after the large-export toast had a chance to paint. */
  buildRows: (format: ExportFormat) => CsvCell[][];
}): Promise<void> {
  const { format, boardName } = opts;
  // Tell the user first and let the toast paint before the heavy work blocks the main thread.
  const busyToast =
    opts.itemCount > LARGE_EXPORT_ROWS ? showToast('Exporting...', { loading: true }) : null;
  if (busyToast !== null) await nextTask();
  try {
    const rows = opts.buildRows(format);
    const count = rows.length - 1;
    if (format === 'xlsx') {
      downloadXlsx(xlsxFileName(boardName), await boardXlsxBytes(rows));
    } else {
      downloadCsv(csvFileName(boardName), boardCsvText(rows));
    }
    const done = `Exported ${count} ${count === 1 ? 'item' : 'items'}`;
    if (busyToast !== null) updateToast(busyToast, done, { type: 'positive' });
    else showToast(done, { type: 'positive' });
  } catch (error) {
    console.error('Could not export the board', error);
    const failed = 'Could not export the board';
    if (busyToast !== null) updateToast(busyToast, failed, { type: 'negative' });
    else showToast(failed, { type: 'negative' });
  }
}
