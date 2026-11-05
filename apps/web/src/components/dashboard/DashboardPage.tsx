import {
  canEditBoard,
  canManageBoard,
  resolveBoardRole,
  type DashboardWidget,
} from '@atrium/shared';
import { Button, Loader } from '@vibe/core';
import { Add } from '@vibe/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import {
  dashboardWrites,
  useDashboard,
  useDashboardItems,
  useUserLookup,
  useWorkspace,
  type DashboardDoc,
} from '../../data';
import { NotFoundPage } from '../../pages/NotFoundPage';
import pageStyles from '../../pages/Pages.module.css';
import { useUiStore } from '../AppShell/ui-store';
import { describeError } from '../boards/board-actions';
import { EmptyState } from '../EmptyState/EmptyState';
import { InlineEdit } from '../InlineEdit';
import { showToast } from '../toast-store';
import { AddWidgetDialog } from './AddWidgetDialog';
import { dashboardActions } from './dashboard-actions';
import type { GridItem } from './dashboard-layout';
import { DashboardGrid } from './DashboardGrid';
import styles from './dashboard.module.css';
import { BatteryWidget } from './widgets/BatteryWidget';
import { ChartWidget } from './widgets/ChartWidget';
import { TableWidget } from './widgets/TableWidget';
import { NumbersWidget } from './widgets/NumbersWidget';

type WidgetDialogState = { mode: 'add' } | { mode: 'edit'; widgetId: string } | null;

/** `/dashboards/:dashboardId` - header, the widget grid and its empty, loading and error states. */
export function DashboardPage() {
  const { dashboardId } = useParams();
  const { user, rememberWorkspace } = useAuth();
  const uid = user?.uid ?? '';
  const { data: dashboard, loading } = useDashboard(dashboardId);
  const { data: workspace } = useWorkspace(dashboard?.workspaceId);
  const workspaceId = dashboard?.workspaceId ?? null;

  // Opening a dashboard remembers its workspace as the user's last one.
  useEffect(() => {
    if (workspaceId) rememberWorkspace(workspaceId);
  }, [workspaceId, rememberWorkspace]);

  if (loading) {
    return (
      <div className={pageStyles.center} role="status">
        <Loader size="medium" />
      </div>
    );
  }

  // Missing dashboards and ones the user cannot read look the same on purpose.
  if (!dashboard) return <NotFoundPage />;

  const role = resolveBoardRole(dashboard, uid, workspace?.roles[uid]);

  if (dashboard.state !== 'active') {
    const isOwner = canManageBoard(role);
    return (
      <EmptyState
        size="page"
        title="This dashboard was deleted"
        body={isOwner ? 'You can restore it.' : 'Ask the dashboard owner to restore it.'}
        primaryAction={
          isOwner
            ? {
                label: 'Restore dashboard',
                onClick: () => void dashboardActions.restore(dashboard),
              }
            : undefined
        }
        secondaryAction={{ label: 'Back to workspace', to: `/workspaces/${dashboard.workspaceId}` }}
      />
    );
  }

  return <DashboardView dashboard={dashboard} canEdit={canEditBoard(role)} />;
}

function DashboardView({ dashboard, canEdit }: { dashboard: DashboardDoc; canEdit: boolean }) {
  const openDialog = useUiStore((s) => s.openDialog);
  const items = useDashboardItems(dashboard.boardIds);
  const [dialog, setDialog] = useState<WidgetDialogState>(null);

  const readableBoards = useMemo(() => items.boards.map((b) => b.board), [items.boards]);
  const editing =
    dialog?.mode === 'edit' ? dashboard.widgets.find((w) => w.id === dialog.widgetId) : undefined;

  const fail = (error: unknown, message: string) => {
    console.error(message, error);
    showToast(describeError(error, message), { type: 'negative' });
  };

  const saveLayout = useCallback(
    (layout: GridItem[]) => {
      dashboardWrites
        .setWidgetLayouts(dashboard.id, layout)
        .catch((error: unknown) => fail(error, 'Could not save the layout.'));
    },
    [dashboard.id],
  );

  const memberLookup = useUserLookup(dashboard.workspaceId);
  const userName = useMemo(() => (uid: string) => memberLookup(uid)?.name, [memberLookup]);

  const renderWidget = (widget: DashboardWidget) => {
    const data = {
      boards: items.boards,
      loading: items.loading,
      widgetBoardIds: widget.boardIds,
    };
    switch (widget.type) {
      case 'numbers':
        return <NumbersWidget {...data} settings={widget.settings} />;
      case 'battery':
        return <BatteryWidget {...data} settings={widget.settings} />;
      case 'chart':
        return <ChartWidget {...data} settings={widget.settings} userName={userName} />;
      case 'table':
        return <TableWidget {...data} settings={widget.settings} />;
      default:
        return <div className={styles.widgetNote}>This widget type is coming soon.</div>;
    }
  };

  const openBoards = () => openDialog({ type: 'dashboardBoards', dashboardId: dashboard.id });
  const hiddenBoards = items.unreadableBoardIds.length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <InlineEdit
          value={dashboard.name}
          ariaLabel="Dashboard name"
          readOnly={!canEdit}
          maxLength={80}
          onCommit={(name) => void dashboardActions.rename(dashboard, name)}
          className={styles.title}
        />
        <div className={styles.headerActions}>
          <Button kind="secondary" size="small" onClick={openBoards} disabled={!canEdit}>
            Boards ({dashboard.boardIds.length})
          </Button>
          <Button
            size="small"
            leftIcon={Add}
            onClick={() => setDialog({ mode: 'add' })}
            disabled={!canEdit || dashboard.boardIds.length === 0}
          >
            Add widget
          </Button>
        </div>
      </header>

      <div className={styles.notes}>
        {hiddenBoards > 0 ? (
          <p className={styles.note} role="status">
            {hiddenBoards === 1
              ? "1 board you can't access is hidden."
              : `${hiddenBoards} boards you can't access are hidden.`}
          </p>
        ) : null}
        {items.truncatedFrom > 0 ? (
          <p className={styles.note} role="status">
            Showing data from the first boards only ({items.truncatedFrom} are selected).
          </p>
        ) : null}
      </div>

      {dashboard.boardIds.length === 0 ? (
        <EmptyState
          size="page"
          title="Choose the boards this dashboard reads"
          body="Widgets show live numbers from the boards you pick."
          primaryAction={canEdit ? { label: 'Choose boards', onClick: openBoards } : undefined}
        />
      ) : items.error ? (
        <EmptyState
          size="page"
          title="We couldn't load this dashboard's data"
          body="None of its boards could be read. Check your access, or try again."
          primaryAction={{ label: 'Try again', onClick: items.retry }}
          secondaryAction={canEdit ? { label: 'Change boards', onClick: openBoards } : undefined}
        />
      ) : dashboard.widgets.length === 0 ? (
        <EmptyState
          size="page"
          title="Add your first widget"
          body="Charts, tables and numbers summarise your boards at a glance."
          primaryAction={
            canEdit ? { label: 'Add widget', onClick: () => setDialog({ mode: 'add' }) } : undefined
          }
        />
      ) : (
        <DashboardGrid
          widgets={dashboard.widgets}
          canEdit={canEdit}
          renderWidget={renderWidget}
          onLayoutChange={saveLayout}
          onEdit={(widget) => setDialog({ mode: 'edit', widgetId: widget.id })}
          onDuplicate={(widget) =>
            void dashboardWrites
              .duplicateWidget(dashboard.id, widget.id)
              .catch((error: unknown) => fail(error, 'Could not duplicate the widget.'))
          }
          onRemove={(widget) =>
            void dashboardWrites
              .removeWidget(dashboard.id, widget.id)
              .catch((error: unknown) => fail(error, 'Could not remove the widget.'))
          }
        />
      )}

      {dialog?.mode === 'add' || (dialog?.mode === 'edit' && editing) ? (
        <AddWidgetDialog
          dashboard={dashboard}
          boards={readableBoards}
          widget={editing}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
