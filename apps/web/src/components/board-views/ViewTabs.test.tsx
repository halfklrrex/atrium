import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardViewDoc } from '../../data';
import { syntheticMainView } from '../../data/views';
import { useFilterStore } from '../board-filters';
import { BoardViewsContext, type BoardViewsValue } from './view-context';
import { viewPermissions } from './view-permissions';
import { ViewTabs } from './ViewTabs';

const rename = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  viewWrites: { rename },
}));

const view = (
  id: string,
  name: string,
  ownerId: string | null,
  position: string,
): BoardViewDoc => ({
  ...syntheticMainView(),
  id,
  name,
  position,
  ownerId,
  synthetic: undefined,
});

const main = { ...syntheticMainView() };
const shared = view('v1', 'Due this week', null, 'a1');
const personal = view('p1', 'My tasks', 'me', 'a2');
const goTo = vi.fn();

function renderTabs(options: { canEdit: boolean; shown?: BoardViewDoc }) {
  const shownView = options.shown ?? main;
  const value: BoardViewsValue = {
    views: [main, shared, personal],
    view: shownView,
    actions: {
      boardId: 'b1',
      uid: 'me',
      canEdit: options.canEdit,
      views: [main, shared, personal],
      goTo,
    },
    permissions: viewPermissions(shownView, 'me', options.canEdit),
    save: () => Promise.resolve(),
    ready: true,
  };
  return render(
    <MemoryRouter>
      <BoardViewsContext.Provider value={value}>
        <ViewTabs />
      </BoardViewsContext.Provider>
    </MemoryRouter>,
  );
}

const openMenuOf = (name: string) => fireEvent.contextMenu(screen.getByText(name));
const menuItems = () =>
  screen
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '')
    .filter(Boolean);

beforeEach(() => {
  goTo.mockClear();
  useFilterStore.setState({ activeView: {}, views: {} });
});

describe('view tabs', () => {
  it('shows one tab per view, with a person icon on personal views', () => {
    renderTabs({ canEdit: true });
    expect(screen.getByText('Main table')).toBeInTheDocument();
    expect(screen.getByText('Due this week')).toBeInTheDocument();
    expect(screen.getByText('My tasks')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Personal view')).toHaveLength(1);
  });

  it('marks tabs with unsaved changes', () => {
    useFilterStore.getState().syncView('b1', 'v1', null);
    useFilterStore.getState().setHiddenColumnIds('b1', ['a']);
    renderTabs({ canEdit: true, shown: shared });
    expect(screen.getAllByRole('img', { name: 'Unsaved changes' })).toHaveLength(1);
  });

  it('lists every tab action for an editor on a shared view', () => {
    renderTabs({ canEdit: true });
    openMenuOf('Due this week');
    expect(menuItems()).toEqual(['Rename', 'Duplicate', 'Make personal', 'Delete']);
  });

  it('offers only Duplicate on Main table', () => {
    renderTabs({ canEdit: true });
    openMenuOf('Main table');
    expect(menuItems()).toEqual(['Duplicate']);
  });

  it('offers a viewer only Duplicate on a shared view', () => {
    renderTabs({ canEdit: false });
    openMenuOf('Due this week');
    expect(menuItems()).toEqual(['Duplicate']);
  });

  it('lets a viewer manage their own personal view, but not share it', () => {
    renderTabs({ canEdit: false });
    openMenuOf('My tasks');
    expect(menuItems()).toEqual(['Rename', 'Duplicate', 'Delete']);
  });

  it('lets an editor share their personal view', () => {
    renderTabs({ canEdit: true });
    openMenuOf('My tasks');
    expect(menuItems()).toEqual(['Rename', 'Duplicate', 'Make shared', 'Delete']);
  });

  it('renames a view inline: Rename, type, Enter', async () => {
    renderTabs({ canEdit: true });
    openMenuOf('Due this week');
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'View name' });
    fireEvent.change(input, { target: { value: 'Due soon' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(rename).toHaveBeenCalledWith('b1', 'me', 'v1', 'Due soon'));
    expect(screen.queryByRole('textbox', { name: 'View name' })).toBeNull();
  });

  it('navigates to a view when its tab is clicked', () => {
    renderTabs({ canEdit: true });
    fireEvent.click(screen.getByText('Due this week'));
    expect(goTo).toHaveBeenCalledWith('v1');
  });

  it('adds views from the plus menu, with only the later types marked as coming soon', async () => {
    renderTabs({ canEdit: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add view' }));
    const items = await screen.findAllByRole('menuitem');
    const titles = items.map((item) => item.textContent);
    expect(titles).toEqual(
      expect.arrayContaining(['Table', 'Kanban', 'Calendar', 'Timeline', 'Gantt', 'Chart', 'Map']),
    );
    const kanban = items.find((item) => item.textContent === 'Kanban');
    expect(kanban?.className).not.toMatch(/disabled/);
    const calendar = items.find((item) => item.textContent === 'Calendar');
    expect(calendar?.className).toMatch(/disabled/);
    const table = items.find((item) => item.textContent === 'Table');
    expect(table?.className).not.toMatch(/disabled/);
  });
});
