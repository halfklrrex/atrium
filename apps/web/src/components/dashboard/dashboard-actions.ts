import { dashboardWrites, type DashboardDoc } from '../../data';
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

export const dashboardActions = {
  rename: (dashboard: DashboardDoc, name: string) =>
    attempt(
      () => dashboardWrites.updateDashboard(dashboard.id, { name }),
      'Could not rename the dashboard.',
    ),

  moveTo: (dashboard: DashboardDoc, to: { folderId: string | null; position: string }) =>
    attempt(
      () => dashboardWrites.updateDashboard(dashboard.id, to),
      'Could not move the dashboard.',
    ),

  trash: (dashboard: DashboardDoc) =>
    attempt(
      () => dashboardWrites.setDashboardState(dashboard.id, 'deleted'),
      'Could not move the dashboard to trash.',
    ),

  restore: (dashboard: DashboardDoc) =>
    attempt(
      () => dashboardWrites.setDashboardState(dashboard.id, 'active'),
      'Could not restore the dashboard.',
    ),
};
