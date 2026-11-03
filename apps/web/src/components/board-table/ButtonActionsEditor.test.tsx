import type { ButtonAction, GroupDef } from '@atrium/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColumnSettingsPopup } from './ColumnSettings';
import { tableActions, type TableCtx } from './table-actions';
import { TableEnvContext, type TableEnv } from './table-env';
import type { ColumnView } from './table-model';
import { useTableStore } from './table-store';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const mockCtx: TableCtx = { boardId: 'board-1', uid: 'user-1', columns: [] };

const textColumn: ColumnView = {
  def: { id: 'col_text', type: 'text', title: 'Notes', position: 'a0', settings: {} },
  settings: {},
  width: 140,
};
const formulaColumn: ColumnView = {
  def: { id: 'col_calc', type: 'formula', title: 'Calc', position: 'a1', settings: {} },
  settings: {},
  width: 140,
};
const groups: GroupDef[] = [
  { id: 'g_todo', title: 'To do', color: '#579bfc', position: 'a0' },
  { id: 'g_done', title: 'Done', color: '#00c875', position: 'a1' },
];

const env: TableEnv = {
  boardId: 'board-1',
  uid: 'user-1',
  canEdit: true,
  columns: [textColumn, formulaColumn],
  subitemColumns: [],
  groups,
  nameWidth: 300,
  ctx: mockCtx,
  getModels: () => [],
  getItems: () => [],
  scrollElement: null,
  onResize: vi.fn(),
};

function buttonColumn(actions: ButtonAction[]): ColumnView {
  const settings = { label: 'Ship', color: '#579bfc', actions };
  return {
    def: { id: 'col_btn', type: 'button', title: 'Ship', position: 'a2', settings },
    settings,
    width: 140,
  };
}

function renderButton(actions: ButtonAction[]) {
  return render(
    <TableEnvContext.Provider value={env}>
      <ColumnSettingsPopup column={buttonColumn(actions)} anchor={document.body} />
    </TableEnvContext.Provider>,
  );
}

const apply = () => screen.getByRole('button', { name: 'Apply' });

describe('Button actions editor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tableActions, 'updateColumn').mockResolvedValue(undefined);
    useTableStore.getState().reset(null);
  });

  it('saves a button with no actions as an empty list', () => {
    renderButton([]);
    fireEvent.click(apply());
    expect(tableActions.updateColumn).toHaveBeenCalledWith(mockCtx, 'col_btn', {
      settings: { label: 'Ship', color: '#579bfc', actions: [] },
    });
  });

  it('adds actions from the menu, lists only writable columns and saves them in order', async () => {
    const user = userEvent.setup();
    renderButton([]);
    const add = screen.getByRole('combobox', { name: 'Add action' });
    await user.selectOptions(add, 'archive_item');
    await user.selectOptions(add, 'move_to_group');
    await user.selectOptions(add, 'rename_item');
    await user.selectOptions(add, 'set_value');

    const rows = screen.getAllByRole('group');
    expect(rows).toHaveLength(4);
    const picker = within(rows[3]!).getByRole('combobox');
    const options = within(picker)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Notes');
    expect(options).not.toContain('Calc');
    expect(within(rows[3]!).getByRole('alert')).toHaveTextContent('This column was deleted');
    expect(apply()).toBeDisabled();

    await user.click(within(rows[1]!).getByRole('radio', { name: 'Done' }));
    await user.clear(within(rows[2]!).getByRole('textbox'));
    await user.type(within(rows[2]!).getByRole('textbox'), '{{name} shipped');
    await user.selectOptions(picker, 'col_text');
    await user.click(within(rows[3]!).getByRole('checkbox', { name: 'Clear value' }));
    expect(apply()).toBeEnabled();

    await user.click(within(rows[3]!).getAllByRole('button', { name: 'Move up' })[0]!);
    fireEvent.click(apply());
    const saved = vi.mocked(tableActions.updateColumn).mock.calls[0]![2].settings as {
      actions: ButtonAction[];
    };
    expect(saved.actions).toEqual([
      { type: 'archive_item' },
      { type: 'move_to_group', groupId: 'g_done' },
      { type: 'set_value', columnId: 'col_text', value: null },
      { type: 'rename_item', template: '{name} shipped' },
    ]);
  });

  it('removes an action and stops at five with the reason shown', async () => {
    const user = userEvent.setup();
    renderButton(Array.from({ length: 5 }, () => ({ type: 'archive_item' }) as ButtonAction));
    const add = screen.getByRole('combobox', { name: 'Add action' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'A button runs at most 5 actions');
    await user.click(
      within(screen.getAllByRole('group')[0]!).getByRole('button', { name: 'Remove' }),
    );
    expect(screen.getAllByRole('group')).toHaveLength(4);
    expect(add).toBeEnabled();
  });

  it('flags a deleted group and blocks saving', () => {
    renderButton([{ type: 'move_to_group', groupId: 'g_gone' }]);
    expect(screen.getByRole('alert')).toHaveTextContent('This group was deleted');
    expect(apply()).toBeDisabled();
    fireEvent.click(apply());
    expect(tableActions.updateColumn).not.toHaveBeenCalled();
  });
});
