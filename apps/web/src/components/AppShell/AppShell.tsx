import { useEffect } from 'react';
import { useAuth } from '../../auth/auth-context';
import { useMembersStore } from '../../data/members-store';
import { useInvitesStore } from '../membership/invites-store';
import { Outlet, useNavigate } from 'react-router';
import { useItemViewStore } from '../item-view/item-view-store';
import { Sidebar } from '../Sidebar/Sidebar';
import { ToastHost } from '../ToastHost';
import styles from './AppShell.module.css';
import { DialogHost } from '../dialogs/DialogHost';
import { OfflineNotice } from '../OfflineNotice';
import { NotificationsPanel } from './NotificationsPanel';
import { ItemCardDrawer } from '../item-card/ItemCardDrawer';
import { TopBar } from './TopBar';
import { useCurrentWorkspace } from './useCurrentWorkspace';
import { useUiStore } from './ui-store';

/**
 * Authenticated layout, modelled on monday's shell: a top bar on the app background, and below it
 * one rounded surface that holds the sidebar and the routed page.
 */
export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  // The row's open icon lives outside React; it navigates through the router registered here.
  const navigate = useNavigate();
  useEffect(() => {
    useItemViewStore.getState().setNavigate((to, options) => void navigate(to, options));
    return () => useItemViewStore.getState().setNavigate(null);
  }, [navigate]);

  // Avatars and people cells resolve names against the workspace being shown.
  const { workspace } = useCurrentWorkspace();
  const workspaceId = workspace?.id ?? null;
  useEffect(() => {
    useMembersStore.getState().setActiveWorkspaceId(workspaceId);
  }, [workspaceId]);

  // Pending invitations are fetched once per session, right after bootstrap.
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (uid) void useInvitesStore.getState().load(uid);
  }, [uid]);

  return (
    <div className={styles.shell}>
      <OfflineNotice />
      <TopBar />
      <div className={styles.surface}>
        <Sidebar />
        {sidebarOpen ? (
          <button
            type="button"
            className={styles.scrim}
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}
        <main className={styles.content} id="main-content">
          <Outlet />
        </main>
      </div>
      <NotificationsPanel />
      <DialogHost />
      <ToastHost />
      <ItemCardDrawer />
    </div>
  );
}
