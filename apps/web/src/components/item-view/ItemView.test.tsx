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
  setState: vi.fn(() => Promise.resolve()),
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
  itemWrites: {
    setValue: mocks.setValue,
    setDescription: vi.fn(),
    rename: vi.fn(),
    setState: mocks.setState,
  },
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
  const location = useLocation();
  return (
    <>
      <div data-testid="where">{location.pathname}</div>
      <div data-testid="state">{JSON.stringify(location.state)}</div>
    </>
  );
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
    mocks.setState.mockClear();
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

  it('opens a subitem page from the parent, recording fromItem and fromBoard', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Child task' }));
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1/items/s1'),
    );
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
      fromBoard: true,
      fromItem: 'i2',
    });
  });

  it('opens a subitem with the keyboard (Enter) and renames with F2', async () => {
    const user = userEvent.setup();
    const first = renderView();
    screen.getByRole('button', { name: 'Child task' }).focus();
    await user.keyboard('{F2}');
    expect(screen.getByRole('textbox', { name: 'Subitem name Child task' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/boards/b1/items/i2');
    first.unmount();
    renderView();
    screen.getByRole('button', { name: 'Child task' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1/items/s1');
  });

  it('opens a subitem with its Open icon', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Open Child task' }));
    expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1/items/s1');
  });

  it('renames a subitem on double click', async () => {
    const user = userEvent.setup();
    renderView();
    await user.dblClick(screen.getByRole('button', { name: 'Child task' }));
    expect(screen.getByRole('textbox', { name: 'Subitem name Child task' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByTestId('where').textContent).toBe('/boards/b1/items/i2');
  });

  describe('a subitem page', () => {
    beforeEach(() => {
      mocks.items.push(
        makeItem({ id: 's2', name: 'Second child', position: 'a1', parentItemId: 'i2' }),
      );
    });

    it('shows the parent crumb, no Subitems section and subitem wording', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderView('s1', board, { fromBoard: true, fromItem: 'i2' });
      expect(screen.getByRole('dialog', { name: 'Subitem Child task' })).toBeTruthy();
      const crumb = screen.getByRole('link', { name: 'Back to Second' });
      expect(crumb.getAttribute('href')).toBe('/boards/roadmap-b1/items/i2');
      expect(screen.queryByRole('region', { name: 'Subitems' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add subitem' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Subitem actions' }));
      expect(await screen.findByRole('menuitem', { name: 'Duplicate subitem' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Archive subitem' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Delete subitem' })).toBeTruthy();
    });

    it('the parent crumb opens the parent', async () => {
      renderView('s1', board, { fromBoard: true, fromItem: 'i2' });
      await userEvent.click(screen.getByRole('link', { name: 'Back to Second' }));
      expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1/items/i2');
    });

    it('steps through the siblings', async () => {
      renderView('s1', board, { fromBoard: true, fromItem: 'i2' });
      expect(screen.getByText('1 / 2')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Previous subitem' }).getAttribute('aria-disabled'),
      ).toBe('true');
      await userEvent.click(screen.getByRole('button', { name: 'Next subitem' }));
      expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1/items/s2');
    });

    it('closes to the board, not back to the parent, when opened from it', async () => {
      renderView('s1', board, { fromBoard: true, fromItem: 'i2' });
      await userEvent.keyboard('{Escape}');
      expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1');
    });

    it('steps to a sibling keeping only fromBoard and fromItem', async () => {
      renderView('s1', board, {
        fromBoard: true,
        fromItem: 'i2',
        updateId: 'u9',
        section: 'subitems',
      });
      await userEvent.click(screen.getByRole('button', { name: 'Next subitem' }));
      expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
        fromBoard: true,
        fromItem: 'i2',
      });
    });

    it('archive goes to the parent, and Close from there goes to the board', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderView('s1', board, { fromBoard: true, fromItem: 'i2' });
      await user.click(screen.getByRole('button', { name: 'Subitem actions' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Archive subitem' }));
      await waitFor(() =>
        expect(screen.getByTestId('where').textContent).toBe('/boards/roadmap-b1/items/i2'),
      );
      expect(mocks.setState).toHaveBeenCalledWith('u1', 'b1', ['s1'], 'archived');
      expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
        fromBoard: true,
        toBoard: true,
      });
    });

    it('the parent crumb replaces the entry and marks Close to the board', async () => {
      renderView('s1', board, { fromBoard: true, fromItem: 'i2' });
      await userEvent.click(screen.getByRole('link', { name: 'Back to Second' }));
      expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({
        fromBoard: true,
        toBoard: true,
      });
    });

    it('hides the crumb when the parent is not active', () => {
      mocks.items = mocks.items.filter((i) => (i as { id: string }).id !== 'i2');
      renderView('s1', board, {});
      expect(screen.queryByTestId('parent-crumb')).toBeNull();
    });

    it('skips an archived sibling when stepping', () => {
      mocks.items = mocks.items.filter((i) => (i as { id: string }).id !== 's2');
      renderView('s1', board, {});
      expect(screen.queryByRole('button', { name: 'Next subitem' })).toBeNull();
    });

    it('opens directly from a link with no router state', () => {
      renderView('s1', board, {});
      expect(screen.getByRole('link', { name: 'Back to Second' })).toBeTruthy();
    });
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
