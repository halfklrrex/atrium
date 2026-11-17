import { docWrites, type DocMetaDoc } from '../../data';
import { describeError } from '../boards/board-actions';
import { showToast } from '../toast-store';

/** Run a write and turn failure into a toast instead of an unhandled rejection. */
async function attempt(task: () => Promise<unknown>, failure: string): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (error) {
    console.error(failure, error);
    showToast(describeError(error, failure), { type: 'negative' });
    return false;
  }
}

export const docActions = {
  rename: (doc: DocMetaDoc, name: string) =>
    attempt(() => docWrites.renameDoc(doc.id, name), 'Could not rename the doc.'),

  moveTo: (doc: DocMetaDoc, to: { folderId: string | null; position: string }) =>
    attempt(() => docWrites.moveDoc(doc.id, to.folderId, to.position), 'Could not move the doc.'),

  trash: (doc: DocMetaDoc) =>
    attempt(() => docWrites.deleteDoc(doc.id), 'Could not move the doc to trash.'),

  restore: (doc: DocMetaDoc) =>
    attempt(() => docWrites.restoreDoc(doc.id), 'Could not restore the doc.'),
};
