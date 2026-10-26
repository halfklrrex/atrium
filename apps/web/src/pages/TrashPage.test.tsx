import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeWorkspace } from '../test/fixtures';
import { TrashPage } from './TrashPage';
import type { BoardDoc } from '../data/model';

const mocks = vi.hoisted(() => ({
  boards: [] as BoardDoc[],
  setBoardState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
  }),
}));

vi.mock('../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspace: (id: string) => ({
    data: makeWorkspace({
      id,
      name: 'Primary Workspace',
      ownerId: 'u1',
      memberIds: ['u1'],
      roles: { u1: 'owner' },
    }),
    loading: false,
    error: null,
  }),
  useAllWorkspaceBoards: () => ({
    data: mocks.boards,
    loading: false,
    error: null,
  }),
  writes: {
    setBoardState: (...args: unknown[]) => mocks.setBoardState(...args),
  },
}));

function renderTrash() {
  render(
    <MemoryRouter initialEntries={['/workspaces/w1/trash']}>
      <Routes>
        <Route path="/workspaces/:workspaceId/trash" element={<TrashPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TrashPage', () => {
  it('renders empty trash state when no deleted boards exist', () => {
    mocks.boards = [makeBoard({ id: 'b1', name: 'Active Board', state: 'active' })];
    renderTrash();

    expect(screen.getByText('Archive & Trash')).toBeInTheDocument();
    expect(screen.getByText('Trash is empty.')).toBeInTheDocument();
  });

  it('renders deleted boards and allows restoring', async () => {
    const deleted = makeBoard({ id: 'b-del', name: 'Deleted Project', state: 'deleted' });
    mocks.boards = [deleted];

    renderTrash();

    expect(screen.getByText('Deleted Project')).toBeInTheDocument();
    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    expect(restoreBtn).toBeInTheDocument();

    fireEvent.click(restoreBtn);
    expect(mocks.setBoardState).toHaveBeenCalledWith('b-del', 'active');
  });

  it('switches to archived boards tab and displays archived boards', () => {
    const archived = makeBoard({ id: 'b-arch', name: 'Archived Roadmap', state: 'archived' });
    mocks.boards = [archived];

    renderTrash();

    expect(screen.getByText('Trash is empty.')).toBeInTheDocument();

    const archivedTab = screen.getByRole('tab', { name: /archived boards/i });
    fireEvent.click(archivedTab);

    expect(screen.getByText('Archived Roadmap')).toBeInTheDocument();
  });
});
