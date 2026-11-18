import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';
import { BoardMenu } from './BoardMenu';

const openDialog = vi.hoisted(() => vi.fn());

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', () => ({
  useWorkspace: () => ({
    data: { name: 'Home', roles: { u1: 'member' }, memberIds: ['u1'] },
    loading: false,
    error: null,
  }),
  useBoards: () => ({ data: [], loading: false, error: null }),
  useBoardViews: () => ({ data: [], loading: false, error: null }),
  useFolders: () => ({ data: [], loading: false, error: null }),
  useFavorites: () => ({ data: [], loading: false, error: null }),
  useItems: () => ({ data: [], loading: false, error: null }),
  useUserLookup: () => () => undefined,
}));
vi.mock('../AppShell/ui-store', () => ({
  useUiStore: (select: (s: Record<string, unknown>) => unknown) => select({ openDialog }),
}));
vi.mock('./board-actions', () => ({ boardActions: {} }));

async function openMenu(role: 'owner' | 'editor' | 'viewer') {
  const board = makeBoard({ id: 'b1', name: 'Plans', access: { u1: role }, accessUids: ['u1'] });
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MemoryRouter>
      <BoardMenu board={board} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Options for Plans' }));
  await screen.findByRole('menuitem', { name: 'Export' });
  return user;
}

describe('BoardMenu Integrations', () => {
  it('is offered to board owners', async () => {
    await openMenu('owner');
    expect(screen.getByRole('menuitem', { name: 'Integrations' })).toBeInTheDocument();
  });

  it.each(['editor', 'viewer'] as const)('is hidden from a board %s', async (role) => {
    await openMenu(role);
    expect(screen.queryByRole('menuitem', { name: 'Integrations' })).not.toBeInTheDocument();
  });
});
