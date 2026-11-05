import { describe, expect, it } from 'vitest';
import { describeAutomation, type DescribeBoard } from './describe-automation';

const board: DescribeBoard = {
  columns: [
    {
      id: 'status',
      type: 'status',
      title: 'Status',
      settings: {
        labels: [
          { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
          { id: 'd', index: 1, label: 'Done', color: '#00c875' },
        ],
      },
    },
    { id: 'notes', type: 'text', title: 'Notes', settings: {} },
    { id: 'go', type: 'button', title: 'Go', settings: {} },
    { id: 'ok', type: 'checkbox', title: 'Approved', settings: {} },
    {
      id: 'tags',
      type: 'dropdown',
      title: 'Area',
      settings: {
        labels: [
          { id: 1, label: 'Web' },
          { id: 2, label: 'API' },
        ],
        limitSelect: false,
      },
    },
  ],
  groups: [
    { id: 'g-done', title: 'Done items' },
    { id: 'g-new', title: 'New' },
  ],
};

describe('describeAutomation', () => {
  it('describes status_changed with a target label and a move action', () => {
    expect(
      describeAutomation(
        {
          trigger: { type: 'status_changed', columnId: 'status', toLabelId: 1 },
          conditions: [],
          actions: [{ type: 'move_to_group', groupId: 'g-done' }],
        },
        board,
      ),
    ).toBe('When Status changes to Done, then move the item to Done items');
  });

  it('describes status_changed with any label', () => {
    expect(
      describeAutomation(
        {
          trigger: { type: 'status_changed', columnId: 'status' },
          conditions: [],
          actions: [{ type: 'archive_item' }],
        },
        board,
      ),
    ).toBe('When Status changes, then archive the item');
  });

  it('describes item_created, with and without a group', () => {
    const actions = [{ type: 'archive_item' as const }];
    expect(
      describeAutomation({ trigger: { type: 'item_created' }, conditions: [], actions }, board),
    ).toBe('When an item is created, then archive the item');
    expect(
      describeAutomation(
        { trigger: { type: 'item_created', groupId: 'g-new' }, conditions: [], actions },
        board,
      ),
    ).toBe('When an item is created in New, then archive the item');
  });

  it('describes button_clicked, conditions of every operator and every action type', () => {
    const text = describeAutomation(
      {
        trigger: { type: 'button_clicked', columnId: 'go' },
        conditions: [
          { columnId: 'status', op: 'is', value: { index: 0 } },
          { columnId: 'notes', op: 'is_not', value: 'skip' },
          { columnId: 'ok', op: 'is_not_empty' },
        ],
        actions: [
          { type: 'set_value', columnId: 'status', value: { index: 1 } },
          { type: 'rename_item', template: 'Done: {name}' },
          { type: 'notify', uids: ['u1'], message: 'Finished' },
        ],
      },
      board,
      { personName: () => 'Avery Quinn' },
    );
    expect(text).toBe(
      'When Go is clicked and Status is Working on it, Notes is not skip and Approved is not empty, ' +
        'then set Status to Done, rename the item to "Done: {name}" and notify Avery Quinn: "Finished"',
    );
  });

  it('describes is_empty, checkbox and dropdown values', () => {
    const text = describeAutomation(
      {
        trigger: { type: 'item_created' },
        conditions: [
          { columnId: 'notes', op: 'is_empty' },
          { columnId: 'ok', op: 'is', value: { checked: true } },
          { columnId: 'tags', op: 'is', value: { ids: [1, 2] } },
        ],
        actions: [{ type: 'archive_item' }],
      },
      board,
    );
    expect(text).toContain('Notes is empty');
    expect(text).toContain('Approved is checked');
    expect(text).toContain('Area is Web, API');
  });

  it('counts people when names are unknown or many', () => {
    const one = describeAutomation(
      {
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [{ type: 'notify', uids: ['a'] }],
      },
      board,
    );
    expect(one).toBe('When an item is created, then notify 1 person');
    const many = describeAutomation(
      {
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [{ type: 'notify', uids: ['a', 'b', 'c'] }],
      },
      board,
      { personName: () => 'Someone' },
    );
    expect(many).toBe('When an item is created, then notify 3 people');
  });

  it('survives deleted columns and groups', () => {
    const text = describeAutomation(
      {
        trigger: { type: 'status_changed', columnId: 'gone', toLabelId: 3 },
        conditions: [{ columnId: 'gone2', op: 'is', value: 'x' }],
        actions: [
          { type: 'set_value', columnId: 'gone3', value: 'y' },
          { type: 'move_to_group', groupId: 'gone-group' },
        ],
      },
      board,
    );
    expect(text).toBe(
      'When a deleted column changes to a label and a deleted column is a value, ' +
        'then set a deleted column to a value and move the item to a deleted group',
    );
  });
});
