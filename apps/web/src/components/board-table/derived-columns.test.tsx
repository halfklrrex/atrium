import {
  columnRegistry,
  defineColumnType,
  ratingColumn,
  textColumn,
  type ColumnDef,
} from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Text as TextIcon } from '@vibe/icons';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineColumnUi, registerColumnUi } from '../../columns/registry';
import type { ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import { tableActions } from './table-actions';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  create: vi.fn(),
  createMany: vi.fn(),
  setValue: vi.fn(),
  toggleVote: vi.fn(),
  clearColumn: vi.fn(),
  copyColumn: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useItems: () => ({ data: mocks.items, loading: false, error: null }),
  useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
  updateBoardStructure: vi.fn(),
  itemWrites: {
    create: mocks.create,
    createMany: mocks.createMany,
    setValue: mocks.setValue,
    toggleVote: mocks.toggleVote,
    clearColumn: mocks.clearColumn,
    copyColumn: mocks.copyColumn,
    setState: vi.fn(),
    move: vi.fn(),
    moveMany: vi.fn(),
    rename: vi.fn(),
  },
}));

// Test-only derived type (no production type is derived yet) and a capped numeric type.
columnRegistry.register(
  defineColumnType({
    ...textColumn,
    type: 'test_item_id',
    label: 'Test item ID',
    derived: true,
    compute: (ctx) => `ID-${ctx.item.id}`,
  }),
);
columnRegistry.register(
  defineColumnType({
    ...ratingColumn,
    type: 'test_capped',
    label: 'Test capped',
    validateValue: (v, s) =>
      v.rating <= s.limit ? { ok: true } : { ok: false, message: `Must be at most ${s.limit}` },
  }),
);
// Test-only server-managed type: stores a text value, written only by Cloud Functions (FW2).
columnRegistry.register(
  defineColumnType({
    ...textColumn,
    type: 'test_managed',
    label: 'Test managed',
    serverManaged: true,
  }),
);
registerColumnUi(
  defineColumnUi<string, unknown>({
    type: 'test_managed',
    icon: TextIcon,
    tone: 'orange',
    // An editor is declared on purpose: a server-managed cell must still never open it.
    editor: 'inline',
    Cell: ({ value }) => <span>{value}</span>,
    Editor: () => <input aria-label="managed editor" />,
  }),
);
registerColumnUi(
  defineColumnUi<string, unknown>({
    type: 'test_item_id',
    icon: TextIcon,
    tone: 'orange',
    // An editor is declared on purpose: a derived cell must still never open it.
    editor: 'inline',
    Cell: ({ value }) => <span>{value}</span>,
    Editor: () => <input aria-label="derived editor" />,
  }),
);

const columns: ColumnDef[] = [
  { id: 'ident', type: 'test_item_id', title: 'Ident', position: 'a0', settings: {} },
  {
    id: 'cap',
    type: 'test_capped',
    title: 'Capped',
    position: 'a1',
    settings: { limit: 3, symbol: 'stars' },
  },
  { id: 'managed', type: 'test_managed', title: 'Managed', position: 'a2', settings: {} },
];

const board = makeBoard({
  id: 'b1',
  access: { u1: 'owner' },
  columns,
  groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
});

const item = (): ItemDoc =>
  makeItem({ id: 'i1', name: 'Write spec', groupId: 'g1', position: 'a0', values: {} });

beforeEach(() => {
  mocks.items = [item()];
  mocks.create.mockReset().mockResolvedValue('new-id');
  mocks.createMany.mockReset().mockResolvedValue([]);
  mocks.setValue.mockReset().mockResolvedValue(undefined);
  mocks.toggleVote.mockReset().mockResolvedValue(undefined);
  mocks.clearColumn.mockReset().mockResolvedValue(undefined);
  mocks.copyColumn.mockReset().mockResolvedValue(undefined);
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
  useToastStore.setState({ toasts: [] });
});

describe('derived columns in the board table', () => {
  it('renders the computed value read-only and never opens an editor or writes', async () => {
    render(<BoardTable board={board} />);
    const cell = document.querySelector('[data-cell="i1:ident"]') as HTMLElement;
    expect(cell).toHaveTextContent('ID-i1');

    await userEvent.click(cell);
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByLabelText('derived editor')).toBeNull();

    await userEvent.keyboard('{Delete}');
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('refuses a programmatic write to a derived cell with a toast', async () => {
    const ctx = { boardId: 'b1', uid: 'u1', columns };
    const written = await tableActions.setCell(ctx, 'i1', 'ident', 'hack');
    expect(written).toBe(false);
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      text: 'This column is calculated automatically',
      type: 'negative',
    });
  });

  it('refuses values that break a settings rule and writes valid ones', async () => {
    const ctx = { boardId: 'b1', uid: 'u1', columns };
    expect(await tableActions.setCell(ctx, 'i1', 'cap', { rating: 9 })).toBe(false);
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.text).toBe('Must be at most 3');

    expect(await tableActions.setCell(ctx, 'i1', 'cap', { rating: 2 })).toBe(true);
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i1', 'cap', { rating: 2 });
  });

  it('refuses a write to a column that no longer exists', async () => {
    const ctx = { boardId: 'b1', uid: 'u1', columns };
    expect(await tableActions.setCell(ctx, 'i1', 'gone', 'x')).toBe(false);
    expect(mocks.setValue).not.toHaveBeenCalled();
  });

  it('strips derived ids from the values of duplicated items', async () => {
    const ctx = { boardId: 'b1', uid: 'u1', columns };
    const legacy = makeItem({
      id: 'i9',
      name: 'Old',
      groupId: 'g1',
      position: 'a0',
      values: { ident: 'stale', cap: { rating: 1 } },
    });
    await tableActions.duplicateItems(ctx, [legacy], () => [legacy]);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    const inputs = mocks.createMany.mock.calls[0]![2] as { values: Record<string, unknown> }[];
    expect(inputs[0]!.values).toEqual({ cap: { rating: 1 } });
  });
});

describe('server-managed columns in the board table (FW2)', () => {
  const ctx = { boardId: 'b1', uid: 'u1', columns };
  const withManagedValue = () =>
    makeItem({
      id: 'i1',
      name: 'Write spec',
      groupId: 'g1',
      position: 'a0',
      values: { managed: 'tracked by server' },
    });

  it('shows the stored value read-only, with a tooltip, and never opens an editor or writes', async () => {
    mocks.items = [withManagedValue()];
    render(<BoardTable board={board} />);
    const cell = document.querySelector('[data-cell="i1:managed"]') as HTMLElement;
    expect(cell).toHaveTextContent('tracked by server');
    expect(cell).toHaveAttribute('title', 'Managed by Atrium');

    await userEvent.click(cell);
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByLabelText('managed editor')).toBeNull();

    await userEvent.keyboard('{Delete}');
    expect(mocks.setValue).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('leaves ordinary cells without the tooltip', () => {
    render(<BoardTable board={board} />);
    const cell = document.querySelector('[data-cell="i1:ident"]') as HTMLElement;
    expect(cell).not.toHaveAttribute('title');
  });

  it('refuses a programmatic write, empty ones included, with the Atrium message', async () => {
    for (const value of ['hack', null]) {
      expect(await tableActions.setCell(ctx, 'i1', 'managed', value)).toBe(false);
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        text: 'This column is updated by Atrium automatically',
        type: 'negative',
      });
    }
    expect(mocks.setValue).not.toHaveBeenCalled();
  });

  it('drops server-managed values from duplicated items', async () => {
    const source = makeItem({
      id: 'i9',
      name: 'Old',
      groupId: 'g1',
      position: 'a0',
      values: { managed: 'server data', ident: 'stale', cap: { rating: 1 } },
    });
    await tableActions.duplicateItems(ctx, [source], () => [source]);
    const inputs = mocks.createMany.mock.calls[0]![2] as { values: Record<string, unknown> }[];
    expect(inputs[0]!.values).toEqual({ cap: { rating: 1 } });
  });

  it('does not try to clean up or copy cells of a server-managed column', async () => {
    const def = columns.find((c) => c.id === 'managed')!;
    const source = withManagedValue();

    expect(await tableActions.deleteColumn(ctx, def, [source.id])).toBe(true);
    expect(mocks.clearColumn).not.toHaveBeenCalled();

    const view = { def, settings: {}, width: 100 };
    expect(await tableActions.duplicateColumn(ctx, view, [source])).toEqual(expect.any(String));
    expect(mocks.copyColumn).not.toHaveBeenCalled();
  });
});

describe('vote column in the board table', () => {
  const voteCol: ColumnDef = {
    id: 'vote_1',
    type: 'vote',
    title: 'Votes',
    position: 'a3',
    settings: {},
  };
  const voteCtx = { boardId: 'b1', uid: 'u1', columns: [...columns, voteCol] };

  it('delegates to toggleVote when toggling a vote', async () => {
    const itemWithoutVote = makeItem({
      id: 'i1',
      name: 'Task',
      groupId: 'g1',
      position: 'a0',
      values: {},
    });
    expect(
      await tableActions.setCell(voteCtx, 'i1', 'vote_1', { votersIds: ['u1'] }, itemWithoutVote),
    ).toBe(true);
    expect(mocks.toggleVote).toHaveBeenCalledWith('u1', 'b1', 'i1', 'vote_1', false);

    const itemWithVote = makeItem({
      id: 'i1',
      name: 'Task',
      groupId: 'g1',
      position: 'a0',
      values: { vote_1: { votersIds: ['u1', 'u2'] } },
    });
    expect(
      await tableActions.setCell(voteCtx, 'i1', 'vote_1', { votersIds: ['u2'] }, itemWithVote),
    ).toBe(true);
    expect(mocks.toggleVote).toHaveBeenCalledWith('u1', 'b1', 'i1', 'vote_1', true);
  });

  it('clears cell via setValue when value is null or undefined', async () => {
    const itemWithVote = makeItem({
      id: 'i1',
      name: 'Task',
      groupId: 'g1',
      position: 'a0',
      values: { vote_1: { votersIds: ['u1'] } },
    });
    expect(await tableActions.setCell(voteCtx, 'i1', 'vote_1', null, itemWithVote)).toBe(true);
    expect(mocks.setValue).toHaveBeenCalledWith('u1', 'b1', 'i1', 'vote_1', null);
    expect(mocks.toggleVote).not.toHaveBeenCalled();
  });
});
