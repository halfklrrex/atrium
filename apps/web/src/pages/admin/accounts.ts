import type { AccountListItem, AccountStatus } from '@atrium/shared';

export type StatusFilter = 'all' | AccountStatus;

export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'pending', 'approved', 'blocked'];

export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  pending: 'Pending',
  approved: 'Approved',
  blocked: 'Blocked',
};

const STATUS_ORDER: Record<AccountStatus, number> = { pending: 0, approved: 1, blocked: 2 };

const time = (iso: string | null): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

/** Default order: Pending first, then Approved, then Blocked; newest sign-up first within a status. */
export function sortAccounts(rows: readonly AccountListItem[]): AccountListItem[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      time(b.createdAt) - time(a.createdAt) ||
      a.uid.localeCompare(b.uid),
  );
}

/** Client-side filter over the loaded rows: status, then a name or email substring. */
export function filterAccounts(
  rows: readonly AccountListItem[],
  filter: StatusFilter,
  term: string,
): AccountListItem[] {
  const needle = term.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      (needle === '' ||
        (r.displayName ?? '').toLowerCase().includes(needle) ||
        (r.email ?? '').toLowerCase().includes(needle)),
  );
}

export function accountName(r: Pick<AccountListItem, 'displayName' | 'email'>): string {
  return r.displayName ?? r.email ?? 'Unnamed account';
}

export function formatAccountDate(iso: string | null): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
