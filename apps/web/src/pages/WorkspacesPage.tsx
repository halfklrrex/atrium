import { Button, Loader } from '@vibe/core';
import { Add } from '@vibe/icons';
import { Link } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { useUiStore } from '../components/AppShell/ui-store';
import { WorkspaceTile } from '../components/WorkspaceTile';
import { useWorkspaces } from '../data';
import home from './Home.module.css';
import styles from './Pages.module.css';

/** `/workspaces` - "Browse all": every workspace the user belongs to. */
export function WorkspacesPage() {
  const { user } = useAuth();
  const { data: workspaces, loading } = useWorkspaces(user?.uid ?? null);
  const openDialog = useUiStore((s) => s.openDialog);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>All workspaces</h1>
      <p className={styles.lead}>Workspaces you are a member of.</p>
      {loading ? (
        <Loader size="small" />
      ) : (
        <ul className={home.workspaces}>
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link to={`/workspaces/${workspace.id}`} className={home.workspaceCard}>
                <WorkspaceTile icon={workspace.icon} color={workspace.color} size="md" />
                <span className={home.workspaceText}>
                  <span className={home.workspaceName}>{workspace.name}</span>
                  <span className={home.workspaceMeta}>
                    {workspace.kind === 'closed' ? 'Closed workspace' : 'Open workspace'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="small" leftIcon={Add} onClick={() => openDialog({ type: 'newWorkspace' })}>
          Add workspace
        </Button>
      </div>
    </div>
  );
}
