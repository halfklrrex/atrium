import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../test/fixtures';
import { currentViewState, isViewDirty, useFilterStore, viewKey } from './filter-store';
import { HideColumnsPopover } from './HideColumnsPopover';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const board = makeBoard({
  id: 'b1',
  columns: [
    column('status', 'status', 'Status', 'a0'),
    column('owner', 'people', 'Owner', 'a1'),
    column('due', 'date', 'Due date', 'a2'),
  ],
});

const hidden = () => currentViewState('b1').hiddenColumnIds;

beforeEach(() => {
  useFilterStore.setState({ activeView: {}, views: {} });
  useFilterStore.getState().syncView('b1', 'main', null);
});

async function open() {
  const user = userEvent.setup();
  render(<HideColumnsPopover board={board} />);
  await user.click(screen.getByRole('button', { name: 'Hide columns' }));
  return user;
}

describe('Hide columns popover', () => {
  it('lists the board columns, all shown, and no Item column', async () => {
    await open();
    expect(screen.getByRole('checkbox', { name: 'Status' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Owner' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Due date' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Item' })).toBeNull();
  });

  it('hides and shows one column, which counts as an unsaved change', async () => {
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Owner' }));
    expect(hidden()).toEqual(['owner']);
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'main')])).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Owner' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Hide columns, 1 hidden' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Owner' }));
    expect(hidden()).toEqual([]);
    expect(isViewDirty(useFilterStore.getState().views[viewKey('b1', 'main')])).toBe(false);
  });

  it('hides all and shows all', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Hide all' }));
    expect([...hidden()].sort()).toEqual(['due', 'owner', 'status']);
    expect(screen.getByRole('button', { name: 'Hide all' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(hidden()).toEqual([]);
  });

  it('finds columns by name', async () => {
    const user = await open();
    await user.type(screen.getByRole('textbox', { name: 'Find columns' }), 'du');
    expect(screen.getByRole('checkbox', { name: 'Due date' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Status' })).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: 'Find columns' }));
    await user.type(screen.getByRole('textbox', { name: 'Find columns' }), 'zzz');
    expect(screen.getByText('No columns match.')).toBeInTheDocument();
  });

  it('shows the hidden count of a saved view', () => {
    useFilterStore.getState().syncView('b1', 'v1', {
      filter: currentViewStateFilter(),
      hiddenColumnIds: ['status', 'due', 'gone'],
    });
    render(<HideColumnsPopover board={board} />);
    // The id of a column that no longer exists is not counted.
    expect(screen.getByRole('button', { name: 'Hide columns, 2 hidden' })).toBeInTheDocument();
  });
});

function currentViewStateFilter() {
  const { personIds, filterGroup, sortConditions, groupByColumnId } = currentViewState('b1').filter;
  return { personIds, filterGroup, sortConditions, groupByColumnId };
}
