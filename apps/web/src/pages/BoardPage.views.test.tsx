import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticMainView } from '../data/views';
import type { BoardViewDoc } from '../data';
import { useFilterStore } from '../components/board-filters';
import { writeLastView } from '../components/board-views/view-paths';
import { makeBoard } from '../test/fixtures';
import { BoardPage } from './BoardPage';

const mocks = vi.hoisted(() => ({ views: [] as unknown[] }));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, rememberWorkspace: () => undefined }),
}));
vi.mock('../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useBoard: () => ({ data: makeBoard({ id: 'b1', name: 'Roadmap' }), loading: false, error: null }),
  useWorkspace: () => ({
    data: { name: 'Team', roles: { u1: 'owner' } },
    loading: false,
    error: null,
  }),
  useBoardViews: () => ({ data: mocks.views, loading: false, error: null }),
  writes: { touchRecent: () => Promise.resolve() },
}));
vi.mock('../components/boards/BoardHeader', () => ({ BoardHeader: () => <div>header</div> }));
vi.mock('../components/board-table/BoardTable', () => ({
  BoardTable: () => <div>the table</div>,
}));
vi.mock('../components/item-view/ItemView', () => ({
  ItemView: ({ itemId }: { itemId: string }) => <div>item {itemId}</div>,
}));

const view = (id: string, ownerId: string | null = null): BoardViewDoc => ({
  ...syntheticMainView(),
  id,
  name: id,
  position: id === 'main' ? 'a0' : 'a1',
  ownerId,
  synthetic: id === 'main' ? true : undefined,
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/boards/:boardId" element={<BoardPage />} />
        <Route path="/boards/:boardId/items/:itemId" element={<BoardPage />} />
        <Route path="/boards/:boardId/views/:viewId" element={<BoardPage />} />
        <Route path="/boards/:boardId/views/:viewId/items/:itemId" element={<BoardPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  window.localStorage.clear();
  useFilterStore.setState({ activeView: {}, views: {} });
  mocks.views = [view('main'), view('v2')];
});

describe('board page views', () => {
  it('opens Main table for a board with no remembered view', async () => {
    renderAt('/boards/b1');
    expect(await screen.findByText('the table')).toBeInTheDocument();
    expect(where()).toBe('/boards/b1');
    expect(useFilterStore.getState().activeView['b1']).toBe('main');
  });

  it('opens the last view used on the board', async () => {
    writeLastView('b1', 'v2');
    renderAt('/boards/b1');
    expect(await screen.findByText('the table')).toBeInTheDocument();
    expect(where()).toBe('/boards/b1/views/v2');
    expect(useFilterStore.getState().activeView['b1']).toBe('v2');
  });

  it('remembers the view it shows', async () => {
    renderAt('/boards/b1/views/v2');
    expect(await screen.findByText('the table')).toBeInTheDocument();
    expect(window.localStorage.getItem('atrium.lastView.b1')).toBe('v2');
  });

  it('falls back to Main table when the remembered view is gone', async () => {
    writeLastView('b1', 'deleted');
    renderAt('/boards/b1');
    expect(await screen.findByText('the table')).toBeInTheDocument();
    expect(where()).toBe('/boards/b1');
    expect(useFilterStore.getState().activeView['b1']).toBe('main');
  });

  it('redirects a view that does not exist (or is not yours) to Main table', async () => {
    renderAt('/boards/b1/views/nope');
    expect(await screen.findByText('the table')).toBeInTheDocument();
    expect(where()).toBe('/boards/b1/views/main');
  });

  it('keeps old item links working on Main table, ignoring the remembered view', async () => {
    writeLastView('b1', 'v2');
    renderAt('/boards/b1/items/i1');
    expect(await screen.findByText('item i1')).toBeInTheDocument();
    expect(where()).toBe('/boards/b1/items/i1');
    expect(useFilterStore.getState().activeView['b1']).toBe('main');
  });

  it('opens an item inside a view', async () => {
    renderAt('/boards/b1/views/v2/items/i1');
    expect(await screen.findByText('item i1')).toBeInTheDocument();
    expect(useFilterStore.getState().activeView['b1']).toBe('v2');
  });
});
