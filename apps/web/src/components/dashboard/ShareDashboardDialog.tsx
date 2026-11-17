import { ShareEntityDialog } from '../sharing/ShareEntityDialog';

/** The Share dialog of a dashboard (the shared dialog with `kind: 'dashboard'`). */
export function ShareDashboardDialog({
  dashboardId,
  onClose,
}: {
  dashboardId: string;
  onClose: () => void;
}) {
  return <ShareEntityDialog kind="dashboard" entityId={dashboardId} onClose={onClose} />;
}
