import { resolveUrlNow } from '../components/files/file-url-cache';
import { showToast } from '../components/toast-store';
import { describeCallableError, fileCalls } from './callables';

export interface ColumnFileTarget {
  boardId: string;
  itemId: string;
  columnId: string;
  fileId: string;
}

/** The cache key of a column file's signed URL. */
export const columnFileKey = (t: ColumnFileTarget): string =>
  `${t.boardId}/${t.itemId}/${t.columnId}/${t.fileId}`;

/** Fetch the signed URL of a column file (not cached). */
export const fetchColumnFileUrl = (t: ColumnFileTarget) =>
  fileCalls.getDownloadUrl({
    boardId: t.boardId,
    itemId: t.itemId,
    columnId: t.columnId,
    fileId: t.fileId,
  });

/** Open a column file in a new tab through its signed URL (a fresh cached one is reused). */
export async function openColumnFile(
  target: ColumnFileTarget,
  failureMessage = 'Could not download file. Try again.',
): Promise<void> {
  try {
    const url = await resolveUrlNow(columnFileKey(target), () => fetchColumnFileUrl(target));
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    showToast(describeCallableError(error, failureMessage), { type: 'negative' });
  }
}
