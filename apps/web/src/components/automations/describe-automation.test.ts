import type { ButtonAction } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  describeAutomation,
  describeAutomationParts,
  type DescribeBoard,
} from './describe-automation';

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

  it('describes item_moved and person_assigned triggers', () => {
    const base = { conditions: [], actions: [{ type: 'archive_item' as const }] };
    const people = { id: 'who', type: 'people', title: 'Owner', settings: {} };
    const withPeople = { ...board, columns: [...board.columns, people] };
    expect(
      describeAutomation({ ...base, trigger: { type: 'item_moved', groupId: 'g-done' } }, board),
    ).toBe('When an item is moved to Done items, then archive the item');
    expect(describeAutomation({ ...base, trigger: { type: 'item_moved' } }, board)).toBe(
      'When an item is moved, then archive the item',
    );
    expect(
      describeAutomation(
        { ...base, trigger: { type: 'person_assigned', columnId: 'who' } },
        withPeople,
      ),
    ).toBe('When someone is assigned to Owner, then archive the item');
    expect(
      describeAutomation(
        { ...base, trigger: { type: 'person_assigned', columnId: 'who', uid: 'u1' } },
        withPeople,
      ),
    ).toBe('When someone is assigned to Owner, then archive the item');
  });

  it('describes create_item and post_update, with deleted groups and columns', () => {
    const text = describeAutomation(
      {
        trigger: { type: 'item_moved', groupId: 'gone' },
        conditions: [],
        actions: [
          {
            type: 'create_item',
            name: '{name} follow-up',
            groupId: 'g-new',
            values: { notes: 'x' },
          },
          { type: 'create_item', name: 'Plain' },
          { type: 'create_item', name: 'Lost', groupId: 'gone-group' },
          { type: 'post_update', text: 'Moved on {date}' },
        ],
      },
      board,
    );
    expect(text).toBe(
      'When an item is moved to a deleted group, then create an item "{name} follow-up" in New, ' +
        'create an item "Plain", create an item "Lost" in a deleted group and post an update "Moved on {date}"',
    );
    expect(
      describeAutomation(
        {
          trigger: { type: 'person_assigned', columnId: 'gone' },
          conditions: [],
          actions: [{ type: 'post_update', text: 'Hi' }],
        },
        board,
      ),
    ).toBe('When someone is assigned to a deleted column, then post an update "Hi"');
  });
});

describe('describeAutomation: scheduled triggers (P5d)', () => {
  const withDue: DescribeBoard = {
    ...board,
    columns: [...board.columns, { id: 'due', type: 'date', title: 'Due date', settings: {} }],
  };
  const create: ButtonAction = { type: 'create_item', name: 'Weekly review {date}' };
  const notify: ButtonAction = { type: 'notify', uids: ['u1', 'u2', 'u3'] };
  const zone = 'Europe/Madrid';
  const sentence = (
    trigger: Parameters<typeof describeAutomation>[0]['trigger'],
    actions: Parameters<typeof describeAutomation>[0]['actions'],
    timezone: string | undefined = zone,
    conditions: Parameters<typeof describeAutomation>[0]['conditions'] = [],
  ) => describeAutomation({ trigger, conditions, actions, timezone }, withDue);

  it('describes a weekly recurrence with the weekday, time and zone', () => {
    expect(sentence({ type: 'recurring', every: 'week', weekday: 1, at: '09:00' }, [create])).toBe(
      'Every Monday at 09:00 (Europe/Madrid), then create an item "Weekly review {date}"',
    );
    expect(sentence({ type: 'recurring', every: 'week', weekday: 0, at: '18:30' }, [create])).toBe(
      'Every Sunday at 18:30 (Europe/Madrid), then create an item "Weekly review {date}"',
    );
  });

  it('describes daily and monthly recurrences', () => {
    expect(sentence({ type: 'recurring', every: 'day', at: '07:15' }, [notify])).toBe(
      'Every day at 07:15 (Europe/Madrid), then notify 3 people',
    );
    expect(
      sentence({ type: 'recurring', every: 'month', dayOfMonth: 15, at: '09:00' }, [notify]),
    ).toBe('Every month on day 15 at 09:00 (Europe/Madrid), then notify 3 people');
  });

  it('describes a date arriving before, on and after the date', () => {
    expect(
      sentence({ type: 'date_arrives', columnId: 'due', offsetDays: -3, at: '09:00' }, [notify]),
    ).toBe('3 days before Due date at 09:00 (Europe/Madrid), then notify 3 people');
    expect(
      sentence({ type: 'date_arrives', columnId: 'due', offsetDays: -1, at: '09:00' }, [notify]),
    ).toBe('1 day before Due date at 09:00 (Europe/Madrid), then notify 3 people');
    expect(
      sentence({ type: 'date_arrives', columnId: 'due', offsetDays: 0, at: '08:00' }, [notify]),
    ).toBe('On the day Due date arrives at 08:00 (Europe/Madrid), then notify 3 people');
    expect(
      sentence({ type: 'date_arrives', columnId: 'due', offsetDays: 2, at: '09:00' }, [notify]),
    ).toBe('2 days after Due date at 09:00 (Europe/Madrid), then notify 3 people');
  });

  it("says the date's own time applies when no time is chosen", () => {
    expect(sentence({ type: 'date_arrives', columnId: 'due', offsetDays: 0 }, [notify])).toBe(
      'On the day Due date arrives at its own time or 09:00 (Europe/Madrid), then notify 3 people',
    );
  });

  it('joins conditions with "and" and survives a deleted column and a missing zone', () => {
    expect(
      sentence(
        { type: 'date_arrives', columnId: 'due', offsetDays: 1, at: '09:00' },
        [notify],
        '',
        [{ columnId: 'status', op: 'is', value: { index: 0 } }],
      ),
    ).toBe('1 day after Due date at 09:00 and Status is Working on it, then notify 3 people');
    expect(
      sentence({ type: 'date_arrives', columnId: 'gone', offsetDays: 0, at: '09:00' }, [notify]),
    ).toBe('On the day a deleted column arrives at 09:00 (Europe/Madrid), then notify 3 people');
  });
});

describe('describeAutomationParts', () => {
  const recipe = {
    trigger: { type: 'status_changed', columnId: 'status', toLabelId: 1 },
    conditions: [{ columnId: 'tags', op: 'is', value: { ids: [1] } }],
    actions: [
      { type: 'move_to_group', groupId: 'g-done' },
      { type: 'notify', uids: ['u1', 'u2'] },
    ],
  } satisfies Parameters<typeof describeAutomation>[0];
  const names: Record<string, string> = { u1: 'Avery Quinn', u2: 'Sam Rivera' };
  const options = { personName: (uid: string) => names[uid] ?? null };

  it('joins to exactly the plain sentence', () => {
    const parts = describeAutomationParts(recipe, board, options);
    expect(parts.map((p) => p.text).join('')).toBe(describeAutomation(recipe, board, options));
    expect(parts.map((p) => p.text).join('')).toBe(
      'When Status changes to Done and Area is Web, then move the item to Done items and notify Avery Quinn and Sam Rivera',
    );
  });

  it('marks names as strong and a status label as a chip in its own colour', () => {
    const parts = describeAutomationParts(recipe, board, options);
    expect(parts.find((p) => p.text === 'Status')).toEqual({ text: 'Status', strong: true });
    expect(parts.find((p) => p.text === 'Done')).toEqual({ text: 'Done', color: '#00c875' });
    expect(parts.find((p) => p.text === 'Done items')?.strong).toBe(true);
    expect(parts.find((p) => p.text === 'Avery Quinn and Sam Rivera')?.strong).toBe(true);
  });

  it('keeps a scheduled sentence without "When"', () => {
    const parts = describeAutomationParts(
      {
        trigger: { type: 'recurring', every: 'week', weekday: 5, at: '17:00' },
        conditions: [],
        actions: [{ type: 'archive_item' }],
        timezone: 'UTC',
      },
      board,
    );
    expect(parts.map((p) => p.text).join('')).toBe(
      'Every Friday at 17:00 (UTC), then archive the item',
    );
  });

  it('a deleted label or column stays plain text', () => {
    const parts = describeAutomationParts(
      {
        trigger: { type: 'status_changed', columnId: 'status', toLabelId: 99 },
        conditions: [],
        actions: [{ type: 'set_value', columnId: 'gone', value: { index: 1 } }],
      },
      board,
    );
    expect(parts.some((p) => p.color !== undefined)).toBe(false);
    expect(parts.map((p) => p.text).join('')).toContain('a deleted column');
  });
});
