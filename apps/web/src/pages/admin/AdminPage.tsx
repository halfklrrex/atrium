import { Tab, TabList } from '@vibe/core';
import { useNavigate, useParams } from 'react-router';
import { useIsSiteAdmin } from '../../auth/useIsSiteAdmin';
import { useInboxUnreadCount } from '../../data/inbox';
import { NotFoundPage } from '../NotFoundPage';
import { AccountsTab } from './AccountsTab';
import styles from './AdminPage.module.css';
import { formatInboxCount } from './inbox';
import { InboxTab } from './InboxTab';
import { InboxThreadView } from './InboxThreadView';

export type AdminTab = 'accounts' | 'inbox';

const TABS: readonly AdminTab[] = ['accounts', 'inbox'];
const TAB_PATHS: Record<AdminTab, string> = { accounts: '/admin', inbox: '/admin/inbox' };

/**
 * The site admin screen: the Accounts tab (`/admin`) and the Inbox (`/admin/inbox`, and one
 * conversation at `/admin/inbox/:threadId`).
 */
export function AdminPage({ tab = 'accounts' }: { tab?: AdminTab }) {
  const isAdmin = useIsSiteAdmin();
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId?: string }>();
  const { count } = useInboxUnreadCount(isAdmin);

  if (!isAdmin) return <NotFoundPage />;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Site admin</h1>
      <div className={styles.tabs}>
        <TabList
          activeTabId={TABS.indexOf(tab)}
          onTabChange={(index) => void navigate(TAB_PATHS[TABS[index] ?? 'accounts'])}
        >
          <Tab>Accounts</Tab>
          <Tab>
            <span>
              Inbox
              {count > 0 ? (
                <span className={styles.badge} data-testid="inbox-unread-count">
                  {formatInboxCount(count)}
                </span>
              ) : null}
            </span>
          </Tab>
        </TabList>
      </div>
      {tab === 'accounts' ? <AccountsTab /> : threadId ? <InboxThreadView /> : <InboxTab />}
    </div>
  );
}
