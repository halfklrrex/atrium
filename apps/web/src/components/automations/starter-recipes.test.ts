import { validateAutomation } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_LABELS,
  AVAILABILITY_TITLES,
  BASICS_IDS,
  basicsTemplates,
  TEMPLATE_CATALOG,
  TEMPLATE_CATEGORIES,
  buildStarterRecipes,
  buildTemplateInput,
  plainSentence,
  templatesByAvailability,
  templatesByCategory,
  type StarterBoard,
} from './starter-recipes';

const status = {
  id: 'status',
  type: 'status',
  title: 'Status',
  settings: {
    labels: [
      { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
      { id: 'd', index: 1, label: 'Done', color: '#00c875', isDone: true },
    ],
  },
};
const button = { id: 'go', type: 'button', title: 'Ship', settings: { label: 'Go', actions: [] } };
const groups = [
  { id: 'g1', title: 'This week' },
  { id: 'g2', title: 'Done items' },
];

const full: StarterBoard = { columns: [status, button], groups };

describe('buildStarterRecipes', () => {
  it('builds all three presets from the board, each one valid', () => {
    const starters = buildStarterRecipes(full, 'u1');
    expect(starters.map((s) => s.id)).toEqual([
      'status-to-group',
      'item-created-notify',
      'button-sets-status',
    ]);
    expect(starters[0]!.input.trigger).toEqual({
      type: 'status_changed',
      columnId: 'status',
      toLabelId: 1,
    });
    expect(starters[0]!.input.actions).toEqual([{ type: 'move_to_group', groupId: 'g2' }]);
    expect(starters[1]!.input.actions).toEqual([{ type: 'notify', uids: ['u1'] }]);
    for (const s of starters) {
      const checked = validateAutomation(s.input, { ...full, columns: full.columns }, 'owner');
      expect(checked, s.id).toEqual({ ok: true });
    }
  });

  it('skips presets the board has no fitting column for', () => {
    expect(buildStarterRecipes({ columns: [], groups: [] }, 'u1').map((s) => s.id)).toEqual([
      'item-created-notify',
    ]);
    expect(buildStarterRecipes({ columns: [status], groups }, 'u1').map((s) => s.id)).toEqual([
      'status-to-group',
      'item-created-notify',
    ]);
    expect(
      buildStarterRecipes({ columns: [status, button], groups: [] }, 'u1').map((s) => s.id),
    ).toEqual(['item-created-notify', 'button-sets-status']);
    expect(buildStarterRecipes({ columns: [], groups }, '')).toEqual([]);
  });

  it('falls back to the last group and last label when none is named Done', () => {
    const board: StarterBoard = {
      columns: [
        {
          ...status,
          settings: {
            labels: [
              { id: 'a', index: 0, label: 'Open', color: '#fdab3d' },
              { id: 'b', index: 2, label: 'Closed', color: '#00c875' },
            ],
          },
        },
      ],
      groups: [
        { id: 'x', title: 'One' },
        { id: 'y', title: 'Two' },
      ],
    };
    const [first] = buildStarterRecipes(board, 'u1');
    expect(first!.input.trigger).toMatchObject({ toLabelId: 2 });
    expect(first!.input.actions).toEqual([{ type: 'move_to_group', groupId: 'y' }]);
  });
});

describe('template catalog', () => {
  const stuckStatus = {
    ...status,
    settings: {
      labels: [
        { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
        { id: 's', index: 2, label: 'Stuck', color: '#e2445c' },
        { id: 'd', index: 1, label: 'Done', color: '#00c875', isDone: true },
      ],
    },
  };
  const priority = {
    id: 'prio',
    type: 'status',
    title: 'Priority',
    settings: {
      labels: [
        { id: 'h', index: 0, label: 'High', color: '#e2445c' },
        { id: 'l', index: 1, label: 'Low', color: '#579bfc' },
      ],
    },
  };
  const owner = { id: 'owner', type: 'people', title: 'Owner', settings: {} };
  const due = { id: 'due', type: 'date', title: 'Due date', settings: {} };
  const board: StarterBoard = { columns: [stuckStatus, priority, button, owner, due], groups };

  it('has about 19 entries, 16 of them ready, with unique ids', () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(19);
    expect(TEMPLATE_CATALOG.length).toBeLessThanOrEqual(21);
    expect(templatesByAvailability('ready')).toHaveLength(16);
    expect(new Set(TEMPLATE_CATALOG.map((t) => t.id)).size).toBe(TEMPLATE_CATALOG.length);
  });

  it('is well formed: known categories and availabilities, build only on ready entries', () => {
    const categories: string[] = TEMPLATE_CATEGORIES.map((c) => c.id);
    for (const t of TEMPLATE_CATALOG) {
      expect(categories, t.id).toContain(t.category);
      expect(t.category, t.id).not.toBe('recommended');
      expect(Object.keys(AVAILABILITY_LABELS), t.id).toContain(t.availability);
      expect(typeof t.build === 'function', t.id).toBe(t.availability === 'ready');
      expect(t.sentence.length, t.id).toBeGreaterThan(0);
    }
    expect(categories).not.toContain('ai');
    expect(categories).not.toContain('workspace');
  });

  it('every ready entry makes a valid recipe on a fitting board', () => {
    for (const t of templatesByAvailability('ready')) {
      const input = buildTemplateInput(t, board, 'u1');
      expect(input, t.id).not.toBeNull();
      const checked = validateAutomation(
        { ...input!, timezone: 'Europe/Madrid' },
        { ...board, columns: board.columns, memberUids: ['u1'] },
        'owner',
      );
      expect(checked, t.id).toEqual({ ok: true });
    }
  });

  it('builds nothing for entries that are not ready, and for a board that does not fit', () => {
    for (const t of TEMPLATE_CATALOG.filter((x) => x.availability !== 'ready')) {
      expect(buildTemplateInput(t, board, 'u1'), t.id).toBeNull();
    }
    const bare: StarterBoard = { columns: [], groups: [] };
    const results = templatesByAvailability('ready').map((t) => buildTemplateInput(t, bare, 'u1'));
    expect(results.filter(Boolean)).toHaveLength(2); // notify on create, rename on create
  });

  const build = (id: string, b: StarterBoard, uid = 'u1') =>
    buildTemplateInput(
      TEMPLATE_CATALOG.find((t) => t.id === id)!,
      b,
      uid,
    );
  const check = (input: NonNullable<ReturnType<typeof build>>) =>
    validateAutomation(input, { ...board, columns: board.columns, memberUids: ['u1'] }, 'owner');

  it('group-move-sets-status sets Done when an item lands in the done group', () => {
    const input = build('group-move-sets-status', board)!;
    expect(input.trigger).toEqual({ type: 'item_moved', groupId: 'g2' });
    expect(input.actions).toEqual([{ type: 'set_value', columnId: 'status', value: { index: 1 } }]);
    expect(check(input)).toEqual({ ok: true });
    expect(build('group-move-sets-status', { columns: [], groups })).toBeNull();
  });

  it('person-assigned-notify uses the first people column', () => {
    const input = build('person-assigned-notify', board)!;
    expect(input.trigger).toEqual({ type: 'person_assigned', columnId: 'owner' });
    expect(input.actions).toEqual([{ type: 'notify', uids: ['u1'] }]);
    expect(check(input)).toEqual({ ok: true });
    expect(build('person-assigned-notify', { columns: [status], groups })).toBeNull();
    expect(build('person-assigned-notify', board, '')).toBeNull();
  });

  it('status-creates-item makes a follow-up in the first group', () => {
    const input = build('status-creates-item', board)!;
    expect(input.trigger).toEqual({ type: 'status_changed', columnId: 'status', toLabelId: 1 });
    expect(input.actions).toEqual([
      { type: 'create_item', name: 'Follow-up: {name}', groupId: 'g1' },
    ]);
    expect(check(input)).toEqual({ ok: true });
    expect(build('status-creates-item', { columns: [status], groups: [] })).toBeNull();
  });

  it('stuck-posts-update needs a Stuck or Blocked label', () => {
    const input = build('stuck-posts-update', board)!;
    expect(input.trigger).toEqual({ type: 'status_changed', columnId: 'status', toLabelId: 2 });
    expect(input.actions).toEqual([
      { type: 'post_update', text: '{name} is stuck. Can someone help unblock it?' },
    ]);
    expect(check(input)).toEqual({ ok: true });
    expect(build('stuck-posts-update', { columns: [status], groups })).toBeNull();
  });

  const dated = board;
  const noDate: StarterBoard = { columns: [stuckStatus], groups };
  const checkDated = (input: NonNullable<ReturnType<typeof build>>) =>
    validateAutomation(
      { ...input, timezone: 'Europe/Madrid' },
      { ...board, columns: board.columns, memberUids: ['u1'] },
      'owner',
    );

  it('date-arrives-notify notifies on the day the first date column arrives', () => {
    const input = build('date-arrives-notify', dated)!;
    expect(input.trigger).toEqual({
      type: 'date_arrives',
      columnId: 'due',
      offsetDays: 0,
      at: '09:00',
    });
    expect(input.actions).toEqual([{ type: 'notify', uids: ['u1'] }]);
    expect(checkDated(input)).toEqual({ ok: true });
    expect(build('date-arrives-notify', noDate)).toBeNull();
    expect(build('date-arrives-notify', dated, '')).toBeNull();
  });

  it('weekly-create-item creates an item every Monday in the first group', () => {
    const input = build('weekly-create-item', board)!;
    expect(input.trigger).toEqual({ type: 'recurring', every: 'week', weekday: 1, at: '09:00' });
    expect(input.actions).toEqual([
      { type: 'create_item', name: 'Weekly review {date}', groupId: 'g1' },
    ]);
    expect(checkDated(input)).toEqual({ ok: true });
    expect(build('weekly-create-item', { columns: [], groups: [] })).toBeNull();
  });

  it('overdue-notify fires a day after the date unless the status is Done', () => {
    const input = build('overdue-notify', dated)!;
    expect(input.trigger).toEqual({
      type: 'date_arrives',
      columnId: 'due',
      offsetDays: 1,
      at: '09:00',
    });
    expect(input.conditions).toEqual([{ columnId: 'status', op: 'is_not', value: { index: 1 } }]);
    expect(checkDated(input)).toEqual({ ok: true });
    expect(build('overdue-notify', noDate)).toBeNull();
    expect(build('overdue-notify', { columns: [due], groups })).toBeNull();
  });

  it('filters by category and by availability', () => {
    expect(templatesByCategory('dates').map((t) => t.availability)).toEqual([
      'ready',
      'ready',
      'ready',
    ]);
    expect(templatesByCategory('recommended').every((t) => t.recommended)).toBe(true);
    expect(templatesByCategory('sync').every((t) => t.availability === 'p9')).toBe(true);
    expect(plainSentence(TEMPLATE_CATALOG[0]!)).not.toContain('*');
  });

  it('gives every entry an icon kind and every unavailable one a long title', () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(t.icon, t.id).toBeTruthy();
      if (t.availability !== 'ready') {
        expect(AVAILABILITY_TITLES[t.availability], t.id).toBeTruthy();
      }
    }
  });

  it('lists the three basics, all ready and in the catalog', () => {
    const basics = basicsTemplates();
    expect(basics.map((t) => t.id)).toEqual([...BASICS_IDS]);
    expect(basics.every((t) => t.availability === 'ready')).toBe(true);
  });
});
