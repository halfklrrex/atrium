import type { AccountListItem } from '@atrium/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterAccounts, sortAccounts } from './accounts';
import { AdminPage } from './AdminPage';

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  list: vi.fn(),
  setStatus: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../auth/useIsSiteAdmin', () => ({ useIsSiteAdmin: () => mocks.isAdmin }));
vi.mock('../../lib/callables', () => ({
  accountAdminCalls: { list: mocks.list, setStatus: mocks.setStatus },
  describeCallableError: (e: unknown, fallback: string) =>
    (e as { message?: string } | null)?.message ?? fallback,
}));
vi.mock('../../components/toast-store', () => ({ showToast: mocks.showToast }));

function account(uid: string, over: Partial<AccountListItem> = {}): AccountListItem {
  return {
    uid,
    displayName: uid,
    email: `${uid}@example.com`,
    photoURL: null,
    status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSignInAt: '2026-02-01T00:00:00.000Z',
    ...over,
  };
}

const ACCOUNTS = [
  account('avery', { status: 'approved', createdAt: '2026-01-01T00:00:00.000Z' }),
  account('blake', { status: 'blocked', createdAt: '2026-03-01T00:00:00.000Z' }),
  account('casey', { status: 'pending', createdAt: '2026-04-01T00:00:00.000Z' }),
  account('devon', { status: 'pending', createdAt: '2026-05-01T00:00:00.000Z' }),
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

const rowNames = () =>
  within(screen.getByRole('table', { name: 'Accounts' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByText(/^(avery|blake|casey|devon)$/)[0]!.textContent);

beforeEach(() => {
  mocks.isAdmin = true;
  mocks.list.mockReset().mockResolvedValue({ accounts: ACCOUNTS, nextPageToken: null });
  mocks.setStatus.mockReset().mockResolvedValue({ uid: 'x', status: 'approved', changed: true });
  mocks.showToast.mockReset();
});

describe('account list helpers', () => {
  it('sorts Pending first, then Approved, then Blocked, newest first within a status', () => {
    expect(sortAccounts(ACCOUNTS).map((a) => a.uid)).toEqual(['devon', 'casey', 'avery', 'blake']);
  });

  it('filters by status and by name or email', () => {
    expect(filterAccounts(ACCOUNTS, 'pending', '').map((a) => a.uid)).toEqual(['casey', 'devon']);
    expect(filterAccounts(ACCOUNTS, 'all', ' CASEY@EXAMPLE').map((a) => a.uid)).toEqual(['casey']);
    expect(filterAccounts(ACCOUNTS, 'blocked', 'avery')).toEqual([]);
  });
});

describe('AdminPage', () => {
  it('shows the not-found state to someone without the admin claim and loads nothing', () => {
    mocks.isAdmin = false;
    renderPage();
    expect(screen.getByText("We couldn't find that page")).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('lists accounts with Pending first', async () => {
    renderPage();
    await screen.findByText('devon');
    expect(rowNames()).toEqual(['devon', 'casey', 'avery', 'blake']);
  });

  it('searches the loaded rows and filters by status', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('devon');
    await user.type(screen.getByLabelText('Search accounts'), 'blake');
    expect(rowNames()).toEqual(['blake']);
    await user.clear(screen.getByLabelText('Search accounts'));
    await user.click(screen.getByRole('tab', { name: /^Pending/ }));
    expect(rowNames()).toEqual(['devon', 'casey']);
    await user.click(screen.getByRole('tab', { name: /^Blocked/ }));
    expect(rowNames()).toEqual(['blake']);
  });

  it('loads more pages with the next page token', async () => {
    mocks.list
      .mockResolvedValueOnce({ accounts: ACCOUNTS.slice(0, 2), nextPageToken: 'next' })
      .mockResolvedValueOnce({ accounts: ACCOUNTS.slice(2), nextPageToken: null });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('avery');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('devon');
    expect(mocks.list).toHaveBeenLastCalledWith({ pageToken: 'next' });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('approves a pending account', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('devon');
    await user.click(screen.getByRole('button', { name: 'Approve devon' }));
    expect(mocks.setStatus).toHaveBeenCalledWith({ uid: 'devon', status: 'approved' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve devon' })).not.toBeInTheDocument(),
    );
  });

  it('rolls an approval back and toasts when the callable fails', async () => {
    mocks.setStatus.mockRejectedValue(new Error('Only admins can do that.'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('devon');
    await user.click(screen.getByRole('button', { name: 'Approve devon' }));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Only admins can do that.', {
        type: 'negative',
      }),
    );
    expect(screen.getByRole('button', { name: 'Approve devon' })).toBeInTheDocument();
  });

  it('asks before blocking, and Cancel does nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('avery');
    await user.click(screen.getByRole('button', { name: 'Block avery' }));
    expect(
      screen.getByText(
        "Block avery? They are signed out and can't sign in until you unblock them.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.setStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('blocks after confirming, then unblocks', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('avery');
    await user.click(screen.getByRole('button', { name: 'Block avery' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Block' }),
    );
    expect(mocks.setStatus).toHaveBeenCalledWith({ uid: 'avery', status: 'blocked' });
    await screen.findByRole('button', { name: 'Unblock avery' });

    await user.click(screen.getByRole('button', { name: 'Unblock avery' }));
    expect(mocks.setStatus).toHaveBeenLastCalledWith({ uid: 'avery', status: 'approved' });
    await screen.findByRole('button', { name: 'Block avery' });
  });

  it('rolls a block back when the callable fails', async () => {
    mocks.setStatus.mockRejectedValue(new Error('You cannot block yourself.'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('avery');
    await user.click(screen.getByRole('button', { name: 'Block avery' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Block' }),
    );
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Block avery' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unblock avery' })).not.toBeInTheDocument();
  });

  it('shows a load error', async () => {
    mocks.list.mockRejectedValue(new Error('Admins only.'));
    renderPage();
    expect(await screen.findByText('Admins only.')).toBeInTheDocument();
  });
});
