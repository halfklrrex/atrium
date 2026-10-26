import { Outlet } from 'react-router';
import { Sidebar } from '../Sidebar/Sidebar';
import { ToastHost } from '../ToastHost';
import styles from './AppShell.module.css';
import { DialogHost } from '../dialogs/DialogHost';
import { OfflineNotice } from '../OfflineNotice';
import { NotificationsPanel } from './NotificationsPanel';
import { ItemCardDrawer } from '../item-card/ItemCardDrawer';
import { TopBar } from './TopBar';
import { useUiStore } from './ui-store';

/**
 * Authenticated layout, modelled on monday's shell: a top bar on the app background, and below it
 * one rounded surface that holds the sidebar and the routed page.
 */
export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

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
