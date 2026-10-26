import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useItemViewStore } from './item-view-store';
import { ItemView } from './ItemView';

const mocks = vi.hoisted(() => ({
  setValue: vi.fn(() => Promise.resolve()),
  items: [] as unknown[],
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({
    data: { name: 'Main workspace', roles: { u1: 'owner' } },
    loading: false,
    error: null,
  }),
  itemWrites: { setValue: mocks.setValue, setDescription: vi.fn(), rename: vi.fn() },
}));
vi.mock('../item-card/UpdatesFeed', () => ({ UpdatesFeed: () => <div>updates feed</div> }));
vi.mock('./DescriptionEditor', () => ({ default: () => <div>description editor</div> }));

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const board = makeBoard({
  id: 'b1',
  name: 'Roadmap',
  columns: [
    column('cost', 'numbers', 'Cost', 'a0'),
    column('made', 'creation_log', 'Created', 'a1'),
  ],
  groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderView(itemId = 'i2') {
  return render(
    <MemoryRouter
      initialEntries={[
        '/boards/b1',
        { pathname: `/boards/b1/items/${itemId}`, state: { fromBoard: true } },
      ]}
      initialIndex={1}
    >
      <Routes>
        <Route
          path="/boards/:boardId/items/:itemId"
          element={<ItemView board={board} itemId={itemId} />}
        />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('ItemView', () => {
  beforeEach(() => {
    mocks.setValue.mockClear();
    mocks.items = [
      makeItem({ id: 'i1', name: 'First', position: 'a0' }),
      makeItem({ id: 'i2', name: 'Second', position: 'a1', values: { cost: '5' } }),
      makeItem({ id: 'i3', name: 'Third', position: 'a2' }),
      makeItem({ id: 's1', name: 'Child task', position: 'a0', parentItemId: 'i2' }),
    ];
    useItemViewStore.setState({
      visible: { b1: [{ groupId: 'g1', ids: ['i1', 'i2', 'i3'] }] },
    });
  });

  it('shows the breadcrumb, name, description, fields, subitems and updates', async () => {
    renderView();
    expect(screen.getByRole('dialog', { name: 'Item Second' })).toBeTruthy();
    expect(screen.getByText('Main workspace')).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(await screen.findByText('description editor')).toBeTruthy();
    expect(screen.getByText('Child task')).toBeTruthy();
    expect(screen.getByText('updates feed')).toBeTruthy();
    // One labelled field row per board column.
    expect(screen.getByText('Cost')).toBeTruthy();
    expect(document.querySelector('[data-cell="i2:cost"]')).not.toBeNull();
    expect(document.querySelector('[data-cell="i2:made"]')).not.toBeNull();
  });

  it('edits a field through the same editor and write path as the table', async () => {
    renderView();
    await userEvent.click(document.querySelector('[data-cell="i2:cost"]') as HTMLElement);
    const input = await screen.findByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '12{Enter}');
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i2', 'cost', '12');
  });

  it('does not open an editor on a derived column', async () => {
    renderView();
    await userEvent.click(document.querySelector('[data-cell="i2:made"]') as HTMLElement);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(mocks.setValue).not.toHaveBeenCalled();
  });

  it('steps to the next row of the group', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Next item' }));
    expect(screen.getByTestId('where').textContent).toBe('/boards/b1/items/i3');
  });

  it('closes with Escape and with the X button, back to the board', async () => {
    const first = renderView();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByTestId('where').textContent).toBe('/boards/b1');
    first.unmount();
    renderView();
    await userEvent.click(screen.getAllByRole('button', { name: 'Close item' })[1]!);
    expect(screen.getByTestId('where').textContent).toBe('/boards/b1');
  });
});
