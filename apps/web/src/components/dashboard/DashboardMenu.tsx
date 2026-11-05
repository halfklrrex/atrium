import { canEditBoard, canManageBoard, resolveBoardRole } from '@atrium/shared';
import { Menu, MenuButton, MenuDivider, MenuItem } from '@vibe/core';
import { Delete, Edit } from '@vibe/icons';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useWorkspace, type DashboardDoc } from '../../data';
import { dashboardActions } from './dashboard-actions';

/** "⋯" menu of a dashboard in the sidebar: rename and move to trash. */
export function DashboardMenu({
  dashboard,
  openDashboardId,
  size = 'xs',
  onRename,
  onMenuShow,
  onMenuHide,
}: {
  dashboard: DashboardDoc;
  /** Id of the dashboard whose page is open; trashing it leaves the page. */
  openDashboardId?: string | null;
  size?: 'xxs' | 'xs' | 'small';
  onRename?: () => void;
  onMenuShow?: () => void;
  onMenuHide?: () => void;
}) {
  return (
    <MenuButton
      size={size}
      aria-label={`Options for ${dashboard.name}`}
      closeMenuOnItemClick
      onMenuShow={onMenuShow}
      onMenuHide={onMenuHide}
    >
      <DashboardMenuContent
        dashboard={dashboard}
        openDashboardId={openDashboardId}
        onRename={onRename}
      />
    </MenuButton>
  );
}

/** Separate component so the workspace listener only runs while the menu is open. */
function DashboardMenuContent({
  dashboard,
  openDashboardId,
  onRename,
}: {
  dashboard: DashboardDoc;
  openDashboardId?: string | null;
  onRename?: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace(dashboard.workspaceId);
  const role = resolveBoardRole(dashboard, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(role);
  const isOwner = canManageBoard(role);

  return (
    <Menu id={`dashboard-menu-${dashboard.id}`} size="medium">
      {onRename ? (
        <MenuItem
          title="Rename"
          icon={Edit}
          disabled={!canEdit}
          disableReason="You can't rename this dashboard"
          onClick={onRename}
        />
      ) : null}
      <MenuDivider />
      <MenuItem
        title="Move to trash"
        icon={Delete}
        disabled={!isOwner}
        disableReason="Only dashboard owners can delete it"
        onClick={() => {
          void dashboardActions.trash(dashboard).then((ok) => {
            if (ok && openDashboardId === dashboard.id) void navigate('/');
          });
        }}
      />
    </Menu>
  );
}
