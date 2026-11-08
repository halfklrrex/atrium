import type {
  AccountListItem,
  AccountStatus,
  ListAccountsResult,
  SettableAccountStatus,
} from '@atrium/shared';
import { Avatar, Button, Label, Loader, Search, Tab, TabList } from '@vibe/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showToast } from '../../components/toast-store';
import { accountAdminCalls, describeCallableError } from '../../lib/callables';
import { initialsOf } from '../../lib/format';
import {
  STATUS_FILTERS,
  STATUS_LABELS,
  accountName,
  filterAccounts,
  formatAccountDate,
  sortAccounts,
  type StatusFilter,
} from './accounts';
import styles from './AdminPage.module.css';

const CHIP_COLOR = { pending: 'primary', approved: 'positive', blocked: 'negative' } as const;

function StatusChip({ status }: { status: AccountStatus }) {
  return <Label text={STATUS_LABELS[status]} color={CHIP_COLOR[status]} kind="fill" />;
}

function PersonCell({ row }: { row: AccountListItem }) {
  const name = accountName(row);
  return (
    <div className={styles.person}>
      {row.photoURL ? (
        <Avatar type="img" src={row.photoURL} size="small" aria-label={name} />
      ) : (
        <Avatar
          type="text"
          text={initialsOf(name)}
          size="small"
          backgroundColor="bright-blue"
          aria-label={name}
        />
      )}
      <div className={styles.names}>
        <span className={styles.name}>{name}</span>
        {row.email && row.email !== name ? <span className={styles.email}>{row.email}</span> : null}
      </div>
    </div>
  );
}

/** The Accounts tab (`/admin`): every account with its status, and approve / block actions. */
export function AccountsTab() {
  const [rows, setRows] = useState<AccountListItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [confirming, setConfirming] = useState<AccountListItem | null>(null);

  // `loading` starts true, so the first fetch only has to report its outcome.
  const onPage = useCallback((page: ListAccountsResult) => {
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.uid));
      return [...prev, ...page.accounts.filter((a) => !known.has(a.uid))];
    });
    setNextPageToken(page.nextPageToken);
    setLoading(false);
  }, []);
  const onPageError = useCallback((e: unknown) => {
    setLoadError(describeCallableError(e, 'Could not load the accounts. Try again.'));
    setLoading(false);
  }, []);

  const loadMore = (pageToken: string) => {
    setLoading(true);
    setLoadError(null);
    accountAdminCalls.list({ pageToken }).then(onPage, onPageError);
  };

  useEffect(() => {
    let cancelled = false;
    accountAdminCalls.list({}).then(
      (page) => !cancelled && onPage(page),
      (e: unknown) => !cancelled && onPageError(e),
    );
    return () => {
      cancelled = true;
    };
  }, [onPage, onPageError]);

  const setStatus = useCallback(async (row: AccountListItem, status: SettableAccountStatus) => {
    const previous = row.status;
    const patch = (next: AccountStatus) =>
      setRows((prev) => prev.map((r) => (r.uid === row.uid ? { ...r, status: next } : r)));
    patch(status); // optimistic
    try {
      await accountAdminCalls.setStatus({ uid: row.uid, status });
    } catch (e) {
      patch(previous);
      showToast(describeCallableError(e, `Could not update ${accountName(row)}. Try again.`), {
        type: 'negative',
      });
    }
  }, []);

  const shown = useMemo(
    () => filterAccounts(sortAccounts(rows), filter, term),
    [rows, filter, term],
  );
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: rows.length,
      pending: 0,
      approved: 0,
      blocked: 0,
    };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  return (
    <div className={styles.tabBody}>
      <p className={styles.lead}>Approve new accounts, or block and unblock people.</p>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search
            value={term}
            onChange={setTerm}
            debounceRate={0}
            placeholder="Search by name or email"
            inputAriaLabel="Search accounts"
          />
        </div>
        <TabList
          activeTabId={STATUS_FILTERS.indexOf(filter)}
          onTabChange={(index) => setFilter(STATUS_FILTERS[index] ?? 'all')}
          size="sm"
        >
          {STATUS_FILTERS.map((f) => (
            <Tab key={f}>{`${STATUS_LABELS[f]} (${counts[f]})`}</Tab>
          ))}
        </TabList>
      </div>

      {confirming ? (
        <div className={styles.confirm} role="alertdialog" aria-label="Confirm block">
          <span>
            {`Block ${accountName(confirming)}? They are signed out and can't sign in until you unblock them.`}
          </span>
          <div className={styles.confirmActions}>
            <Button kind="tertiary" size="small" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              color="negative"
              size="small"
              onClick={() => {
                const row = confirming;
                setConfirming(null);
                void setStatus(row, 'blocked');
              }}
            >
              Block
            </Button>
          </div>
        </div>
      ) : null}

      {loadError ? <p className={styles.error}>{loadError}</p> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label="Accounts">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col">Last sign-in</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.uid}>
                <td>
                  <PersonCell row={row} />
                </td>
                <td>
                  <StatusChip status={row.status} />
                </td>
                <td className={styles.muted}>{formatAccountDate(row.createdAt)}</td>
                <td className={styles.muted}>{formatAccountDate(row.lastSignInAt)}</td>
                <td>
                  <div className={styles.actions}>
                    {row.status === 'pending' ? (
                      <Button
                        size="small"
                        aria-label={`Approve ${accountName(row)}`}
                        onClick={() => void setStatus(row, 'approved')}
                      >
                        Approve
                      </Button>
                    ) : null}
                    {row.status === 'blocked' ? (
                      <Button
                        size="small"
                        kind="secondary"
                        aria-label={`Unblock ${accountName(row)}`}
                        onClick={() => void setStatus(row, 'approved')}
                      >
                        Unblock
                      </Button>
                    ) : null}
                    {row.status !== 'blocked' ? (
                      <Button
                        size="small"
                        kind="tertiary"
                        color="negative"
                        aria-label={`Block ${accountName(row)}`}
                        onClick={() => setConfirming(row)}
                      >
                        Block
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <div className={styles.center} role="status" aria-label="Loading accounts">
            <Loader size="medium" />
          </div>
        ) : shown.length === 0 && !loadError ? (
          <div className={styles.center}>
            {rows.length === 0 ? 'No accounts yet.' : 'No matching accounts.'}
          </div>
        ) : null}
      </div>

      {nextPageToken && !loading ? (
        <div className={styles.more}>
          <Button kind="tertiary" size="small" onClick={() => loadMore(nextPageToken)}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
