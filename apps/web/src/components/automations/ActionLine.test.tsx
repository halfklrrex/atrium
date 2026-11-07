import type { ButtonAction } from '@atrium/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildColumnViews } from '../board-table/table-model';

vi.mock('../../lib/firebase', () => ({ db: {}, auth: {} }));
vi.mock('../../data/members-store', () => ({
  UNKNOWN_PERSON_NAME: 'Board member',
  useUserLookup: () => (uid: string) =>
    uid === 'u2'
      ? { name: 'Avery Quinn', photoURL: null }
      : uid === 'u3'
        ? { name: 'Sam Rivera', photoURL: null }
        : undefined,
  useWorkspaceMembers: () => ({
    members: [
      { id: 'u2', displayName: 'Avery Quinn', email: 'avery@example.com' },
      { id: 'u3', displayName: 'Sam Rivera', email: 'sam@example.com' },
    ],
  }),
}));

import { ActionLine } from './ActionLine';
import { newAction } from './new-action';

const columns = buildColumnViews([
  {
    id: 'status',
    type: 'status',
    title: 'Status',
    position: 'a0',
    settings: {
      labels: [
        { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
        { id: 'd', index: 1, label: 'Done', color: '#00c875' },
      ],
    },
  },
  { id: 'notes', type: 'text', title: 'Notes', position: 'a1', settings: {} },
  { id: 'ok', type: 'checkbox', title: 'Approved', position: 'a2', settings: {} },
]);
const groups = [
  { id: 'g1', title: 'Done items', color: '#00c875', position: 'a0' },
  { id: 'g2', title: 'New', color: '#579bfc', position: 'a1' },
];

function Line({
  initial,
  onChange,
  allowedTypes,
}: {
  initial: ButtonAction | null;
  onChange?: (action: ButtonAction | null) => void;
  allowedTypes?: readonly ButtonAction['type'][];
}) {
  const [action, setAction] = useState<ButtonAction | null>(initial);
  return (
    <ol>
      <ActionLine
        action={action}
        index={0}
        keyword="then"
        columns={columns}
        groups={groups}
        boardId="b1"
        allowedTypes={allowedTypes}
        error={null}
        canRemove
        onChange={(next) => {
          setAction(next);
          onChange?.(next);
        }}
        onRemove={() => setAction(null)}
      />
    </ol>
  );
}

const pick = (name: string | RegExp, option: string | RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
};

describe('newAction', () => {
  it('starts every type with its blanks unfilled', () => {
    expect(newAction('set_value')).toEqual({ type: 'set_value', columnId: '', value: undefined });
    expect(newAction('move_to_group')).toEqual({ type: 'move_to_group', groupId: '' });
    expect(newAction('notify')).toEqual({ type: 'notify', uids: [] });
    expect(newAction('rename_item')).toEqual({ type: 'rename_item', template: '' });
    expect(newAction('create_item')).toEqual({ type: 'create_item', name: '' });
    expect(newAction('post_update')).toEqual({ type: 'post_update', text: '' });
    expect(newAction('archive_item')).toEqual({ type: 'archive_item' });
  });
});

describe('ActionLine', () => {
  it('is a blank "do something" with every action type to choose from, and Planned email', () => {
    render(<Line initial={null} />);
    expect(screen.getByText('then')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Action 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Action: do something' }));
    const rows = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(rows.map((o) => o.textContent)).toEqual([
      'set a value',
      'rename the item',
      'move the item',
      'archive the item',
      'notify someone',
      'create an item',
      'post an update',
      'send an emailPlanned',
    ]);
    expect(rows.at(-1)).toBeDisabled();
  });

  it('narrows the choices to the allowed types', () => {
    render(<Line initial={null} allowedTypes={['create_item', 'notify']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Action: do something' }));
    const rows = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(rows.map((o) => o.textContent)).toEqual([
      'notify someone',
      'create an item',
      'send an emailPlanned',
    ]);
  });

  it('moves the item to a group', () => {
    const onChange = vi.fn();
    render(<Line initial={null} onChange={onChange} />);
    pick('Action: do something', 'move the item');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'move_to_group', groupId: '' });
    expect(screen.getByRole('button', { name: 'Group: a group' })).toHaveAttribute('data-blank');
    pick('Group: a group', 'New');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'move_to_group', groupId: 'g2' });
  });

  it('sets a value: column, then the column editor for the value', () => {
    const onChange = vi.fn();
    render(
      <Line initial={{ type: 'set_value', columnId: '', value: undefined }} onChange={onChange} />,
    );
    pick(/^Column to set:/, 'Status');
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'set_value',
      columnId: 'status',
      value: undefined,
    });
    expect(screen.getByRole('button', { name: 'Value for Status: a value' })).toBeInTheDocument();
    // Ticking "clear the cell" is a value too (null), and unticking makes it a blank again.
    fireEvent.click(screen.getByRole('checkbox', { name: 'clear the cell' }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'set_value',
      columnId: 'status',
      value: null,
    });
    expect(screen.getByRole('button', { name: 'Value for Status: empty' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'clear the cell' }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'set_value',
      columnId: 'status',
      value: undefined,
    });
  });

  it('flips a checkbox value with one click', () => {
    const onChange = vi.fn();
    render(
      <Line
        initial={{ type: 'set_value', columnId: 'ok', value: undefined }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Value for Approved:/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'set_value', columnId: 'ok', value: expect.anything() }),
    );
  });

  it('renames with a typed blank', () => {
    const onChange = vi.fn();
    render(<Line initial={{ type: 'rename_item', template: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'New name' }), {
      target: { value: '{date} {name}' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'rename_item', template: '{date} {name}' });
  });

  it('notifies people from a multi-select with avatars, and reads their names', () => {
    const onChange = vi.fn();
    render(<Line initial={{ type: 'notify', uids: ['u2', 'u3'] }} onChange={onChange} />);
    expect(
      screen.getByRole('button', { name: 'People to notify: Avery Quinn and Sam Rivera' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^People to notify:/ }));
    const list = screen.getByRole('listbox', { name: 'People to notify' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    fireEvent.click(within(list).getByRole('option', { name: /Sam Rivera/ }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'notify', uids: ['u2'] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Heads up' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'notify',
      uids: ['u2'],
      message: 'Heads up',
    });
  });

  it('keeps someone who has left listed so they can be removed', () => {
    render(<Line initial={{ type: 'notify', uids: ['gone'] }} />);
    fireEvent.click(screen.getByRole('button', { name: /^People to notify:/ }));
    expect(screen.getByRole('option', { name: 'Former member' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('creates an item with a name, a group and up to ten values', () => {
    const onChange = vi.fn();
    render(<Line initial={{ type: 'create_item', name: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Item name' }), {
      target: { value: 'Review' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'create_item', name: 'Review' });
    pick('In group: the default group', 'New');
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'create_item',
      name: 'Review',
      groupId: 'g2',
    });
    fireEvent.click(screen.getByRole('button', { name: /Add a value/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'create_item',
      name: 'Review',
      groupId: 'g2',
      values: { status: undefined },
    });
    const value = screen.getByRole('group', { name: 'Value 1' });
    expect(within(value).getByRole('button', { name: 'Value column: Status' })).toBeInTheDocument();
    fireEvent.click(within(value).getByRole('button', { name: 'Remove value 1' }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'create_item',
      name: 'Review',
      groupId: 'g2',
    });
    expect(screen.queryByRole('group', { name: 'Value 1' })).toBeNull();
  });

  it('posts an update', () => {
    const onChange = vi.fn();
    render(<Line initial={{ type: 'post_update', text: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Update text' }), {
      target: { value: 'Done on {date}' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'post_update', text: 'Done on {date}' });
  });

  it('archives with no blanks, and shows its error under the line', () => {
    render(
      <ol>
        <ActionLine
          action={{ type: 'archive_item' }}
          index={1}
          keyword="and"
          columns={columns}
          groups={groups}
          boardId="b1"
          error="This group was deleted"
          canRemove={false}
          onChange={vi.fn()}
          onRemove={vi.fn()}
        />
      </ol>,
    );
    expect(screen.getByText('and')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action: archive the item' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This group was deleted');
    expect(screen.queryByRole('button', { name: /^Remove action/ })).toBeNull();
  });

  it('removes the line', () => {
    render(<Line initial={{ type: 'archive_item' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove action 1' }));
    expect(screen.getByRole('button', { name: 'Action: do something' })).toBeInTheDocument();
  });
});
