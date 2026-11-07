import { render, screen, waitFor } from '@testing-library/react';
import { unzipSync } from 'fflate';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';
import { chooseMenuItem } from '../../test/menu';

const download = vi.hoisted(() => vi.fn());
const downloadXlsx = vi.hoisted(() => vi.fn());

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', () => ({
  useWorkspace: () => ({
    data: { name: 'Home', roles: { u1: 'member' }, memberIds: ['u1'] },
    loading: false,
    error: null,
  }),
  useBoards: () => ({ data: [], loading: false, error: null }),
  useFolders: () => ({ data: [], loading: false, error: null }),
  useFavorites: () => ({ data: [], loading: false, error: null }),
  useItems: () => ({
    data: [makeItemStub('i1', 'First item')],
    loading: false,
    error: null,
  }),
  useUserLookup: () => () => undefined,
}));
vi.mock('../AppShell/ui-store', () => ({
  useUiStore: (select: (s: Record<string, unknown>) => unknown) => select({ openDialog: vi.fn() }),
}));
vi.mock('./board-actions', () => ({ boardActions: {} }));
vi.mock('./board-export', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadCsv: download,
  downloadXlsx,
}));

function makeItemStub(id: string, name: string) {
  return {
    id,
    name,
    groupId: 'g1',
    position: 'a0',
    parentItemId: null,
    values: {},
    state: 'active',
    deletedAt: null,
    createdAt: { seconds: 1, nanoseconds: 0 },
    createdBy: 'u1',
    updatedAt: { seconds: 1, nanoseconds: 0 },
    updatedBy: 'u1',
  };
}

import { BoardMenu } from './BoardMenu';
import { useToastStore } from '../toast-store';

const board = makeBoard({
  id: 'b1',
  name: 'Plans: 2026',
  groups: [{ id: 'g1', title: 'Backlog', color: '#579bfc', position: 'a0' }],
  access: { u1: 'owner' },
  accessUids: ['u1'],
});

describe('BoardMenu Export', () => {
  beforeEach(() => {
    download.mockClear();
    downloadXlsx.mockClear();
    useToastStore.setState({ toasts: [] });
  });

  async function open(boardDoc = board) {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <MemoryRouter>
        <BoardMenu board={boardDoc} exportOpenView />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: `Options for ${boardDoc.name}` }));
    return user;
  }

  it('downloads the board file and confirms with a toast', async () => {
    const user = await open();
    await user.hover(await screen.findByRole('menuitem', { name: 'Export' }));
    await chooseMenuItem(user, 'CSV');
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [fileName, csv] = download.mock.calls[0] as [string, string];
    expect(fileName).toBe('Plans- 2026.csv');
    expect(csv.startsWith('﻿Item,Group')).toBe(true);
    expect(csv).toContain('First item,Backlog');
    expect(useToastStore.getState().toasts[0]?.text).toBe('Exported 1 item');
  });

  it('downloads an .xlsx zip from the Excel entry', async () => {
    const user = await open();
    await user.hover(await screen.findByRole('menuitem', { name: 'Export' }));
    await chooseMenuItem(user, 'Excel (.xlsx)');
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalledTimes(1));
    const [fileName, bytes] = downloadXlsx.mock.calls[0] as [string, Uint8Array];
    expect(fileName).toBe('Plans- 2026.xlsx');
    expect(Object.keys(unzipSync(bytes))).toContain('xl/worksheets/sheet1.xml');
    expect(useToastStore.getState().toasts[0]?.text).toBe('Exported 1 item');
  });

  it('is offered to a viewer too', async () => {
    const viewerBoard = makeBoard({
      ...board,
      id: 'b2',
      access: { u1: 'viewer' },
      accessUids: ['u1'],
    });
    const user = await open(viewerBoard);
    expect(await screen.findByRole('menuitem', { name: 'Export' })).toBeEnabled();
    await user.hover(screen.getByRole('menuitem', { name: 'Export' }));
    expect(await screen.findByRole('menuitem', { name: 'CSV' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' })).toBeInTheDocument();
  });
});

describe('BoardMenu Print', () => {
  const print = vi.fn();

  beforeEach(() => {
    print.mockClear();
    window.print = print;
  });

  async function open(role: 'viewer' | 'editor') {
    const boardDoc = makeBoard({
      ...board,
      id: `print-${role}`,
      access: { u1: role },
      accessUids: ['u1'],
    });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <MemoryRouter>
        <BoardMenu board={boardDoc} exportOpenView />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: `Options for ${boardDoc.name}` }));
    return user;
  }

  it.each(['viewer', 'editor'] as const)('is offered to a %s, right after Export', async (role) => {
    await open(role);
    const items = (await screen.findAllByRole('menuitem')).map((el) => el.textContent);
    const exportAt = items.findIndex((t) => t === 'Export');
    expect(exportAt).toBeGreaterThanOrEqual(0);
    expect(items[exportAt + 1]).toContain('Print');
  });

  it('opens the browser print dialog when clicked', async () => {
    const user = await open('editor');
    await chooseMenuItem(user, 'Print');
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });
});
