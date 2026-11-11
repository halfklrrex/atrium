import type * as Callables from '../../lib/callables';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpGrantDoc } from '../../data';
import { ConnectedAppsCard } from './ConnectedAppsCard';
import { describeLastUsed } from './connected-apps';

const mocks = vi.hoisted(() => ({
  grants: [] as unknown[],
  loading: false,
  error: null as Error | null,
  revokeGrant: vi.fn(),
}));

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', () => ({
  useMcpGrants: () => ({ data: mocks.grants, loading: mocks.loading, error: mocks.error }),
}));
vi.mock('../../lib/callables', async (importOriginal) => ({
  ...(await importOriginal<typeof Callables>()),
  mcpCalls: { revokeGrant: mocks.revokeGrant },
}));

const at = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

function grant(overrides: Partial<McpGrantDoc> = {}): McpGrantDoc {
  return {
    id: 'g1',
    clientId: 'c1',
    clientName: 'Claude',
    redirectHost: 'claude.ai',
    scopes: ['atrium:read', 'atrium:write'],
    createdAt: at(new Date(2026, 10, 3, 12).getTime()),
    lastUsedAt: at(Date.now()),
    lastRefreshAt: null,
    revokedAt: null,
    ...overrides,
  } as McpGrantDoc;
}

describe('ConnectedAppsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.grants = [];
    mocks.loading = false;
    mocks.error = null;
    mocks.revokeGrant.mockResolvedValue({ grantId: 'g1', revoked: true });
  });

  it('explains the empty state', () => {
    render(<ConnectedAppsCard />);
    expect(
      screen.getByText(
        'No apps are connected. Add Atrium as a connector in Claude to see it here.',
      ),
    ).toBeVisible();
  });

  it('lists a connected app with scopes and dates', () => {
    mocks.grants = [grant()];
    render(<ConnectedAppsCard />);
    expect(screen.getByText('Claude')).toBeVisible();
    expect(screen.getByText('Read, Write · connected 3 Nov · last used today')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Disconnect Claude' })).toBeVisible();
  });

  it('asks before disconnecting, then revokes the grant', async () => {
    mocks.grants = [grant()];
    render(<ConnectedAppsCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Disconnect Claude?')).toBeVisible();
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(mocks.revokeGrant).toHaveBeenCalledWith({ grantId: 'g1' });
  });

  it('does nothing when the confirmation is cancelled', async () => {
    mocks.grants = [grant()];
    render(<ConnectedAppsCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });

  it('shows why a disconnect failed', async () => {
    mocks.grants = [grant()];
    mocks.revokeGrant.mockRejectedValue({ code: 'functions/not-found', message: 'No such app.' });
    render(<ConnectedAppsCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('No such app.')).toBeVisible();
  });
});

describe('describeLastUsed', () => {
  const now = new Date(2026, 10, 11, 15).getTime();
  it('says today, yesterday or the date', () => {
    expect(describeLastUsed(new Date(2026, 10, 11, 1).getTime(), now)).toBe('today');
    expect(describeLastUsed(new Date(2026, 10, 10, 23).getTime(), now)).toBe('yesterday');
    expect(describeLastUsed(new Date(2026, 10, 3).getTime(), now)).toBe('3 Nov');
  });
});
