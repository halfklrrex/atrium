import { writes } from '../../data';
import { describeError } from '../boards/board-actions';
import { showToast } from '../toast-store';

/** Run a template write; failure becomes a toast and `false` instead of an unhandled rejection. */
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

export const templateActions = {
  rename(workspaceId: string, templateId: string, name: string, description: string) {
    return attempt(
      () => writes.updateTemplate(workspaceId, templateId, { name, description }),
      'Could not rename the template.',
    );
  },

  async remove(workspaceId: string, templateId: string, name: string) {
    const ok = await attempt(
      () => writes.deleteTemplate(workspaceId, templateId),
      'Could not delete the template.',
    );
    if (ok) showToast(`Deleted the template "${name}".`, { type: 'positive' });
    return ok;
  },
};
