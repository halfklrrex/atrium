import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import type { BoardDoc, ItemDoc } from '../../data/model';
import { makeBoard, makeItem, makeWorkspace, ts } from '../../test/fixtures';
import { SEARCH_DEBOUNCE_MS, SearchDialog } from './SearchDialog';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const boardsData: BoardDoc[] = [
  makeBoard({
    id: 'b1',
    name: 'Product roadmap',
    workspaceId: 'w1',
    groups: [{ id: 'g1', title: 'This sprint', color: '#579bfc', position: 'a0' }],
  }),
  makeBoard({ id: 'b2', name: 'Pipeline tracker', workspaceId: 'w1', kind: 'private' }),
];
let boardsLoading = false;
let itemRun: (
  boards: readonly BoardDoc[],
  term: string,
  signal: AbortSignal,
  onBoard: (board: BoardDoc, items: ItemDoc[]) => void,
) => Promise<{ total: number; failed: number }>;

vi.mock('../../data/hooks', () => ({
  useWorkspaces: () => ({
    data: [
      makeWorkspace({ id: 'w1', name: 'Family' }),
      makeWorkspace({ id: 'w2', name: 'Studio' }),
    ],
    loading: false,
    error: null,
  }),
  useRecents: () => ({
    data: [
      { id: 'b2', boardId: 'b2', visitedAt: ts(2000) },
      { id: 'b1', boardId: 'b1', visitedAt: ts(1000) },
    ],
    loading: false,
    error: null,
  }),
}));
vi.mock('../../data/my-work', () => ({
  useReadableBoards: () => ({ data: boardsData, loading: boardsLoading, error: null }),
}));
vi.mock('../../data/search', () => ({
  searchItems: (...args: Parameters<typeof itemRun>) => itemRun(...args),
}));

const auth = { status: 'ready', user: { uid: 'u1' } } as unknown as AuthContextValue;

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const onClose = vi.fn();

function setup(initialTerm?: string) {
  const user = userEvent.setup({ delay: null });
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
        <SearchDialog initialTerm={initialTerm} onClose={onClose} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return user;
}

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 60)));

describe('SearchDialog', () => {
  beforeEach(() => {
    boardsLoading = false;
    onClose.mockClear();
    itemRun = async (_boards, _term, _signal, onBoard) => {
      onBoard(boardsData[0]!, [
        makeItem({ id: 'i1', name: 'Pipeline migration', groupId: 'g1' }),
        makeItem({ id: 'i2', name: 'Sub pipeline step', groupId: 'g1', parentItemId: 'i1' }),
      ]);
      return { total: 2, failed: 0 };
    };
  });

  it('lists recent boards, most recent first, when the term is empty', () => {
    setup();
    const rows = screen.getAllByRole('option');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Pipeline trackerFamily',
      'Product roadmapFamily',
    ]);
    expect(screen.getByText('Recent boards')).toBeInTheDocument();
  });

  it('filters workspaces and boards at once and groups the results', async () => {
    const user = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search everything' }), 'fam');
    expect(screen.getByRole('group', { name: 'Workspaces' })).toHaveTextContent('Family');
    expect(screen.queryByRole('group', { name: 'Boards' })).not.toBeInTheDocument();
  });

  it('streams item results after the debounce, with breadcrumb and subitem rows', async () => {
    const user = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search everything' }), 'pipeline');
    expect(screen.getByRole('group', { name: 'Boards' })).toHaveTextContent('Pipeline tracker');
    expect(screen.queryByRole('group', { name: 'Items' })).not.toBeInTheDocument();
    await settle();
    const items = screen.getByRole('group', { name: 'Items' });
    expect(items).toHaveTextContent('Pipeline migration');
    expect(items).toHaveTextContent('Product roadmap › This sprint');
    expect(screen.getAllByRole('option', { name: /pipeline/i }).length).toBe(3);
  });

  it('moves with the arrow keys, tracks aria-activedescendant and opens with Enter', async () => {
    const user = setup();
    const input = screen.getByRole('searchbox', { name: 'Search everything' });
    await user.type(input, 'pipeline');
    await settle();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1]!.id);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1/items/i1');
  });

  it('opens a board by clicking its row', async () => {
    const user = setup();
    await user.click(screen.getByRole('option', { name: /Product roadmap/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b1');
  });

  it('aborts the older run when the term changes', async () => {
    const signals: AbortSignal[] = [];
    itemRun = (_b, _t, signal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    };
    const user = setup();
    const input = screen.getByRole('searchbox', { name: 'Search everything' });
    await user.type(input, 'pipe');
    await settle();
    await user.type(input, 'line');
    await settle();
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    expect(screen.getByText('Searching 2 boards')).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches', async () => {
    itemRun = async () => ({ total: 2, failed: 0 });
    const user = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search everything' }), 'zzzz');
    await settle();
    expect(screen.getByText('No results for “zzzz”')).toBeInTheDocument();
  });

  it('keeps board results and offers a retry when the item search fails', async () => {
    let attempts = 0;
    itemRun = async () => {
      attempts += 1;
      return attempts === 1 ? { total: 2, failed: 2 } : { total: 2, failed: 0 };
    };
    const user = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search everything' }), 'pipeline');
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t search items');
    expect(screen.getByRole('group', { name: 'Boards' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not query items for a single character', async () => {
    const run = vi.fn(itemRun);
    itemRun = run;
    const user = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search everything' }), 'p');
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText('Type at least 2 characters to search items')).toBeInTheDocument();
  });

  it('starts from the initial term and the Items tab hides boards', async () => {
    const user = setup('pipeline');
    await settle();
    await user.click(screen.getByRole('tab', { name: 'Items' }));
    expect(screen.queryByRole('group', { name: 'Boards' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Items' })).toBeInTheDocument();
  });
});
