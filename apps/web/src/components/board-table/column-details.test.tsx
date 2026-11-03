import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDoc, ItemDoc } from '../../data';
import { makeBoard, makeItem } from '../../test/fixtures';
import { useToastStore } from '../toast-store';
import { BoardTable } from './BoardTable';
import { tableActions, type TableCtx } from './table-actions';
import { useTablePrefs, useTableStore } from './table-store';

const mocks = vi.hoisted(() => ({
  items: [] as unknown[],
  create: vi.fn(),
  updateBoardStructure: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useItems: () => ({ data: mocks.items, loading: false, error: null }),
    useWorkspace: () => ({ data: { roles: { u1: 'owner' } }, loading: false, error: null }),
    updateBoardStructure: mocks.updateBoardStructure,
    itemWrites: {
      create: mocks.create,
      createMany: vi.fn(),
      setValue: vi.fn(),
      setState: vi.fn(),
      toggleVote: vi.fn(),
      clearColumn: vi.fn(),
      move: vi.fn(),
      moveMany: vi.fn(),
      rename: vi.fn(),
    },
  };
});

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const columns: ColumnDef[] = [
  column('status', 'status', 'Status', 'a0'),
  { ...column('budget', 'numbers', 'Budget', 'a1'), defaultValue: 100 },
  column('done', 'checkbox', 'Done', 'a2'),
  column('prog', 'progress', 'Progress', 'a3'),
  column('go', 'button', 'Go', 'a4'),
];

const makeTestBoard = (overrides: Partial<BoardDoc> = {}): BoardDoc =>
  makeBoard({
    id: 'b1',
    access: { u1: 'owner' },
    accessUids: ['u1'],
    columns,
    columnLocks: [],
    groups: [{ id: 'g1', title: 'Alpha', color: '#579bfc', position: 'a0' }],
    ...overrides,
  });

const sampleItems = (): ItemDoc[] => [
  makeItem({
    id: 'i1',
    name: 'First task',
    groupId: 'g1',
    position: 'a0',
    values: { budget: 1200 },
  }),
];

beforeEach(() => {
  mocks.items = sampleItems();
  mocks.create.mockReset().mockResolvedValue('new-id');
  mocks.updateBoardStructure.mockReset().mockResolvedValue(null);
  useTablePrefs.setState({ collapsed: {}, nameWidth: {} });
  useTableStore.getState().reset(null);
  useToastStore.setState({ toasts: [] });
});

/** The columns the last board write would store, computed by running its update function. */
const lastColumns = (): ColumnDef[] => {
  const update = mocks.updateBoardStructure.mock.calls.at(-1)![1] as (s: unknown) => unknown;
  return (update({ columns, subitemColumns: [] }) as { columns: ColumnDef[] }).columns;
};

async function openDetails(title: string) {
  await userEvent.click(screen.getByRole('button', { name: `Options for ${title}` }));
  const item = await screen.findByRole('menuitem', { name: 'Description & default value' });
  fireEvent.mouseEnter(item);
  fireEvent.click(item);
  return screen.findByRole('dialog', { name: `${title} description and default value` });
}

describe('Column description and default value', () => {
  it('saves a default picked with the own cell of the type, and new items start with it', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    const dialog = await openDetails('Done');
    expect(within(dialog).getByText('No default value')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Done' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateBoardStructure).toHaveBeenCalledTimes(1));
    const saved = lastColumns();
    expect(saved.find((c) => c.id === 'done')?.defaultValue).toEqual({ checked: 'true' });
    // The saved default reaches addItem.
    await tableActions.addItem(
      { boardId: 'b1', uid: 'u1', columns: saved },
      { groupId: 'g1', position: 'a1' },
    );
    expect(mocks.create.mock.calls.at(-1)![2].values).toEqual({
      budget: 100,
      done: { checked: 'true' },
    });
  });

  it('edits a default with the inline editor of the type', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    const dialog = await openDetails('Budget');
    await userEvent.click(within(dialog).getByTestId('default-value-box'));
    const input = await within(dialog).findByRole('textbox', { name: 'Budget' });
    await userEvent.clear(input);
    await userEvent.type(input, '250{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateBoardStructure).toHaveBeenCalled());
    expect(lastColumns().find((c) => c.id === 'budget')?.defaultValue).toBe('250');
  });

  it('clears a default', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    const dialog = await openDetails('Budget');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear default' }));
    expect(within(dialog).getByText('No default value')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateBoardStructure).toHaveBeenCalled());
    expect(lastColumns().find((c) => c.id === 'budget')).not.toHaveProperty('defaultValue');
  });

  it('shows the validation message when the default is refused and saves nothing', async () => {
    const stale = columns.map((c) =>
      c.id === 'status' ? { ...c, defaultValue: { index: 99 } } : c,
    );
    render(<BoardTable board={makeTestBoard({ columns: stale })} />);
    const dialog = await openDetails('Status');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'Stage');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Invalid default value/);
    expect(mocks.updateBoardStructure).not.toHaveBeenCalled();
  });

  it('hides the default value for derived and button columns', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    for (const title of ['Progress', 'Go']) {
      const dialog = await openDetails(title);
      expect(within(dialog).getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
      expect(within(dialog).queryByText('Default value')).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    }
  });

  it('counts the description characters, saves it and shows it as the header tooltip', async () => {
    const described = columns.map((c) =>
      c.id === 'budget' ? { ...c, description: 'Planned spend' } : c,
    );
    render(<BoardTable board={makeTestBoard({ columns: described })} />);
    expect(screen.getByText('Budget')).toHaveAttribute('title', 'Planned spend');
    const dialog = await openDetails('Done');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'Ticked');
    expect(within(dialog).getByTestId('description-counter')).toHaveTextContent('6/500');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateBoardStructure).toHaveBeenCalled());
    expect(lastColumns().find((c) => c.id === 'done')?.description).toBe('Ticked');
  });

  it('caps the description at 500 characters and the action refuses more', async () => {
    render(<BoardTable board={makeTestBoard()} />);
    const dialog = await openDetails('Done');
    const box = within(dialog).getByRole('textbox', { name: 'Description' });
    fireEvent.change(box, { target: { value: 'x'.repeat(500) } });
    expect(within(dialog).getByTestId('description-counter')).toHaveTextContent('500/500');
    expect(box).toHaveAttribute('maxlength', '500');
    mocks.updateBoardStructure.mockClear();
    const ctx: TableCtx = { boardId: 'b1', uid: 'u1', columns };
    await tableActions.updateColumn(ctx, 'done', { description: 'x'.repeat(501) });
    const update = mocks.updateBoardStructure.mock.calls[0]![1] as (s: unknown) => unknown;
    expect(() => update({ columns, subitemColumns: [] })).toThrow(/at most 500/);
  });
});

describe('Required hint in table cells', () => {
  const required = (ids: string[]) =>
    columns.map((c) => (ids.includes(c.id) ? { ...c, required: true } : c));

  it('shows "Required" in an empty required cell only', () => {
    render(
      <BoardTable board={makeTestBoard({ columns: required(['status', 'budget', 'done']) })} />,
    );
    expect(screen.getByTestId('required-hint-i1:status')).toHaveTextContent('Required');
    // A filled cell has no hint; an unticked checkbox counts as empty.
    expect(screen.queryByTestId('required-hint-i1:budget')).toBeNull();
    expect(screen.getByTestId('required-hint-i1:done')).toBeInTheDocument();
  });

  it('never shows on a derived or button column, or a column that is not required', () => {
    render(<BoardTable board={makeTestBoard({ columns: required(['prog', 'go']) })} />);
    expect(screen.queryByTestId('required-hint-i1:prog')).toBeNull();
    expect(screen.queryByTestId('required-hint-i1:go')).toBeNull();
    expect(screen.queryByTestId('required-hint-i1:status')).toBeNull();
  });
});
