import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderView(itemId = 'i2', shownBoard = board, state: object = { fromBoard: true }) {
  return render(
    <MemoryRouter
      initialEntries={['/boards/b1', { pathname: `/boards/b1/items/${itemId}`, state }]}
      initialIndex={1}
    >
      <Routes>
        <Route
          path="/boards/:boardId/items/:itemId"
          element={<ItemView board={shownBoard} itemId={itemId} />}
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
    // One labelled field row per board column (the subitem row shows the same columns too).
    expect(screen.getAllByText('Cost')).toHaveLength(2);
    expect(document.querySelector('[data-cell="s1:cost"]')).not.toBeNull();
    expect(document.querySelector('[data-cell="i2:cost"]')).not.toBeNull();
    expect(document.querySelector('[data-cell="i2:made"]')).not.toBeNull();
  });

  it('scrolls to the Subitems section once when opened with section: subitems', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderView('i2', board, { fromBoard: true, section: 'subitems' });
    await screen.findByText('Child task');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(document.getElementById('item-view-subitems'));
  });

  it('does not scroll without a section', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderView();
    await screen.findByText('Child task');
    expect(scroll).not.toHaveBeenCalled();
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

  it('copies the item link from the actions menu', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderView();
    await user.click(screen.getByRole('button', { name: 'Item actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toMatch(/\/items\/i2$/));
  });

  it('steps to the next row of the group', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Next item' }));
    expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1/items/i3');
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

  it('shows the required marker, hint, summary line and column description', () => {
    const marked = {
      ...board,
      columns: [
        { ...board.columns[0]!, required: true, description: 'Planned spend' },
        { ...board.columns[1]!, required: true },
      ],
    };
    // i1 has no cost: one empty required field. The derived column never counts.
    renderView('i1', marked);
    expect(screen.getByTestId('required-summary').textContent).toBe('1 required field is empty');
    expect(screen.getByTestId('field-required-mark-cost')).toBeTruthy();
    expect(screen.getByTestId('required-hint-i1:cost').textContent).toBe('Required');
    expect(screen.queryByTestId('required-hint-i1:made')).toBeNull();
    expect(screen.getByText('Cost').getAttribute('title')).toBe('Planned spend');
  });

  it('hides the summary when no required field is empty', () => {
    const marked = { ...board, columns: [{ ...board.columns[0]!, required: true }] };
    renderView('i2', marked);
    expect(screen.queryByTestId('required-summary')).toBeNull();
    expect(screen.queryByTestId('required-hint-i2:cost')).toBeNull();
  });
});
