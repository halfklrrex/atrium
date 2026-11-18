import type * as Callables from '../../lib/callables';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTokenDoc } from '../../data';
import { ApiTokensCard } from './ApiTokensCard';
import {
  describeToken,
  describeWorkspaces,
  parseCreateForm,
  EMPTY_CREATE_FORM,
} from './api-tokens';

const mocks = vi.hoisted(() => ({
  tokens: [] as unknown[],
  loading: false,
  error: null as Error | null,
  create: vi.fn(),
  revoke: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', () => ({
  useApiTokens: () => ({ data: mocks.tokens, loading: mocks.loading, error: mocks.error }),
  useWorkspaces: () => ({
    data: [
      { id: 'w1', name: 'Home' },
      { id: 'w2', name: 'Club' },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('../../lib/callables', async (importOriginal) => ({
  ...(await importOriginal<typeof Callables>()),
  apiTokenCalls: { create: mocks.create, revoke: mocks.revoke },
}));

const at = (ms: number) =>
  ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as ApiTokenDoc['createdAt'];
const DAY = 86_400_000;

function token(overrides: Partial<ApiTokenDoc> = {}): ApiTokenDoc {
  return {
    id: 't1',
    name: 'Shortcuts',
    prefix: 'atrp_abc',
    scopes: ['read'],
    workspaceIds: null,
    createdAt: at(new Date(2026, 10, 3, 12).getTime()),
    expiresAt: at(Date.now() + 30 * DAY),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  } as ApiTokenDoc;
}

describe('ApiTokensCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokens = [];
    mocks.loading = false;
    mocks.error = null;
    mocks.create.mockResolvedValue({
      tokenId: 't9',
      token: 'atrp_secretsecretsecret',
      prefix: 'atrp_sec',
      expiresAt: Date.now() + 90 * DAY,
    });
    mocks.revoke.mockResolvedValue({ tokenId: 't1', revoked: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mocks.writeText.mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('shows nothing but the header while loading', () => {
    mocks.loading = true;
    render(<ApiTokensCard />);
    expect(screen.getByRole('heading', { name: 'API tokens' })).toBeVisible();
    expect(screen.queryByText(/No API tokens/)).toBeNull();
  });

  it('explains the empty state', () => {
    render(<ApiTokensCard />);
    expect(
      screen.getByText('No API tokens. Create one to use Atrium from scripts and Shortcuts.'),
    ).toBeVisible();
  });

  it('says when the tokens could not load', () => {
    mocks.error = new Error('denied');
    render(<ApiTokensCard />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your API tokens.');
  });

  it('lists a token with its prefix, scopes and restriction', () => {
    mocks.tokens = [token({ scopes: ['read', 'write'], workspaceIds: ['w1', 'w2'] })];
    render(<ApiTokensCard />);
    expect(screen.getByText('Shortcuts')).toBeVisible();
    expect(screen.getByText('atrp_abc…')).toBeVisible();
    expect(
      screen.getByText(
        /Read and write · 2 workspaces: Home, Club · created Nov 3, 2026 · last used never/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revoke Shortcuts' })).toBeVisible();
  });

  it('dims an expired token and labels it', () => {
    mocks.tokens = [token({ expiresAt: at(Date.now() - DAY) })];
    render(<ApiTokensCard />);
    expect(screen.getByText('Shortcuts (Expired)')).toBeVisible();
    expect(screen.getByText(/· expired /)).toBeVisible();
  });

  it('asks before revoking, then revokes the token', async () => {
    mocks.tokens = [token()];
    render(<ApiTokensCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Shortcuts' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Revoke Shortcuts?')).toBeVisible();
    expect(mocks.revoke).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(mocks.revoke).toHaveBeenCalledWith({ tokenId: 't1' });
  });

  it('does nothing when the revoke confirmation is canceled', async () => {
    mocks.tokens = [token()];
    render(<ApiTokensCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Shortcuts' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('shows why a revoke failed', async () => {
    mocks.tokens = [token()];
    mocks.revoke.mockRejectedValue({ code: 'functions/not-found', message: 'No such token.' });
    render(<ApiTokensCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Shortcuts' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('No such token.')).toBeVisible();
  });

  async function openCreate() {
    render(<ApiTokensCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    return screen.findByRole('dialog');
  }

  it('refuses an empty name without calling the server', async () => {
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the token a name.');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a read-only, all-workspaces, 90-day token by default and shows it once', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Name'), '  CLI  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'CLI',
      scopes: ['read'],
      expiresInDays: 90,
    });
    const shown = await screen.findByRole('dialog');
    expect(within(shown).getByLabelText('API token')).toHaveValue('atrp_secretsecretsecret');
    expect(
      within(shown).getByText(/Copy this token now. You won.t be able to see it again./),
    ).toBeVisible();
    await userEvent.click(within(shown).getByRole('button', { name: 'Copy' }));
    expect(await within(shown).findByRole('button', { name: 'Copied' })).toBeVisible();
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue('atrp_secretsecretsecret')).toBeNull();
    // Opening the dialog again starts clean: no token left over.
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    const again = await screen.findByRole('dialog');
    expect(within(again).queryByDisplayValue('atrp_secretsecretsecret')).toBeNull();
    expect(within(again).getByLabelText('Name')).toHaveValue('');
  });

  it('sends write access, picked workspaces and the chosen expiry', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Sync');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Read and write' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Only some workspaces' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Club' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Expires after'), '365');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Sync',
      scopes: ['read', 'write'],
      workspaceIds: ['w2'],
      expiresInDays: 365,
    });
  });

  it('asks for a workspace when the restriction is on but none is picked', async () => {
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Sync');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Only some workspaces' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick at least one workspace');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows the server message when the token limit is reached', async () => {
    mocks.create.mockRejectedValue({
      code: 'functions/resource-exhausted',
      message: 'You can have up to 10 active API tokens. Revoke one first.',
    });
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'One more');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You can have up to 10 active API tokens. Revoke one first.',
    );
    expect(within(dialog).getByLabelText('Name')).toHaveValue('One more');
  });

  it('shows a friendly message on a network error', async () => {
    mocks.create.mockRejectedValue({ code: 'functions/unavailable', message: 'offline' });
    const dialog = await openCreate();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create token' }));
    expect(await within(dialog).findByRole('alert')).toBeVisible();
  });
});

describe('api token helpers', () => {
  it('describes workspace restrictions', () => {
    const names = new Map([['w1', 'Home']]);
    expect(describeWorkspaces(null, names)).toBe('All workspaces');
    expect(describeWorkspaces([], names)).toBe('All workspaces');
    expect(describeWorkspaces(['w1'], names)).toBe('1 workspace: Home');
    expect(describeWorkspaces(['w1', 'gone'], names)).toBe('2 workspaces');
  });

  it('validates the create form', () => {
    expect(parseCreateForm(EMPTY_CREATE_FORM).ok).toBe(false);
    expect(parseCreateForm({ ...EMPTY_CREATE_FORM, name: 'a'.repeat(61) }).ok).toBe(false);
    expect(parseCreateForm({ ...EMPTY_CREATE_FORM, name: 'ok' }).ok).toBe(true);
  });

  it('describes last used with the relative helper', () => {
    const now = new Date(2026, 10, 11, 15).getTime();
    const text = describeToken(
      {
        id: 't',
        name: 'n',
        prefix: 'atrp_abc',
        scopes: ['read'],
        workspaceIds: null,
        createdAt: { toMillis: () => now - 5 * DAY },
        expiresAt: { toMillis: () => now + DAY },
        lastUsedAt: { toMillis: () => now },
        revokedAt: null,
      } as unknown as ApiTokenDoc,
      new Map(),
      now,
    );
    expect(text).toContain('last used today');
    expect(text).toContain('expires Nov 12, 2026');
  });
});
