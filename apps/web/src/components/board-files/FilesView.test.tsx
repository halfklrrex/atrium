import {
  columnRegistry,
  defaultFilesViewSettings,
  defaultViewSettings,
  type ColumnDef,
  type FileAttachment,
} from '@atrium/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemDoc } from '../../data';
import { fileCalls } from '../../lib/callables';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useFilterStore } from '../board-filters';
import { useTableStore } from '../board-table/table-store';
import { useItemCardStore } from '../item-card/item-card-store';
import { clearUrlCache } from '../files/file-url-cache';
import { FilesView } from './FilesView';

const mocks = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../lib/callables', () => ({
  fileCalls: { getDownloadUrl: vi.fn() },
  describeCallableError: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
  useUserLookup: () => (uid: string) => (uid === 'u1' ? { name: 'Avery Quinn' } : undefined),
  usePresence: () => ({ viewers: [] }),
  updateBoardStructure: vi.fn(),
}));

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const withFiles = makeBoard({
  id: 'b1',
  columns: [column('docs', 'files', 'Docs', 'a0')],
  groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
});
const withoutFiles = makeBoard({
  id: 'b1',
  columns: [column('status', 'status', 'Status', 'a0')],
  groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
});

const file = (id: string, name: string, mimeType: string, uploadedAt: string): FileAttachment => ({
  id,
  name,
  storagePath: `boards/b1/items/i1/files/${id}`,
  size: 2048,
  mimeType,
  uploadedAt,
  uploadedBy: 'u1',
});

const sample = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'Kickoff deck',
    values: {
      docs: {
        files: [
          file('f1', 'brief.pdf', 'application/pdf', '2026-11-01T10:00:00.000Z'),
          file('f2', 'budget.xlsx', 'application/octet-stream', '2026-11-03T10:00:00.000Z'),
        ],
      },
    },
  }),
  makeItem({ id: 'i2', name: 'No files here', position: 'a1', values: {} }),
];

function open(board = withFiles) {
  useFilterStore.getState().syncView('b1', 'fv', {
    ...defaultViewSettings(),
    files: defaultFilesViewSettings(),
  });
  return render(<FilesView board={board} />);
}

beforeEach(() => {
  mocks.items = sample();
  clearUrlCache();
  vi.mocked(fileCalls.getDownloadUrl).mockReset();
  useFilterStore.setState({ activeView: {}, views: {} });
  useTableStore.getState().reset(null);
  useItemCardStore.getState().closeItemCard();
});

describe('FilesView', () => {
  it('lists one card per file, newest first, with a count', () => {
    open();
    const list = screen.getByRole('list', { name: 'Files' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(
      screen.getByText('budget.xlsx').compareDocumentPosition(screen.getByText('brief.pdf')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getAllByText('Kickoff deck')).toHaveLength(2);
  });

  it('shows the three empty states', () => {
    const { unmount } = open(withoutFiles);
    expect(screen.getByText('No Files column yet')).toBeInTheDocument();
    unmount();

    mocks.items = [makeItem({ id: 'i2', name: 'Empty', values: {} })];
    const second = open();
    expect(screen.getByText('No files yet')).toBeInTheDocument();
    second.unmount();

    mocks.items = sample();
    open();
    act(() => useTableStore.getState().setSearch('zzzz'));
    return waitFor(() => expect(screen.getByText('No files match')).toBeInTheDocument());
  });

  it('opens the file through getDownloadUrl with the right ids', async () => {
    vi.mocked(fileCalls.getDownloadUrl).mockResolvedValue({
      downloadUrl: 'https://example.com/signed',
      expiresAt: Date.now() + 300_000,
    });
    const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Open brief.pdf' }));
    await waitFor(() =>
      expect(openWindow).toHaveBeenCalledWith(
        'https://example.com/signed',
        '_blank',
        'noopener,noreferrer',
      ),
    );
    expect(fileCalls.getDownloadUrl).toHaveBeenCalledWith({
      boardId: 'b1',
      itemId: 'i1',
      columnId: 'docs',
      fileId: 'f1',
    });
    openWindow.mockRestore();
  });

  it('opens the item panel on its Files tab from the item name', () => {
    open();
    fireEvent.click(screen.getAllByRole('button', { name: 'Kickoff deck' })[0]!);
    expect(useItemCardStore.getState()).toMatchObject({
      activeBoardId: 'b1',
      activeItemId: 'i1',
      tab: 'files',
    });
  });
});
