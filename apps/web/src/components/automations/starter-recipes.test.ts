import { validateAutomation } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_LABELS,
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
  const board: StarterBoard = { columns: [stuckStatus, priority, button], groups };

  it('has about 19 entries, 9 of them ready, with unique ids', () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(19);
    expect(TEMPLATE_CATALOG.length).toBeLessThanOrEqual(21);
    expect(templatesByAvailability('ready')).toHaveLength(9);
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
      const checked = validateAutomation(input!, { ...board, columns: board.columns }, 'owner');
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

  it('filters by category and by availability', () => {
    expect(templatesByCategory('dates').map((t) => t.availability)).toEqual(['p5d', 'p5d', 'p5d']);
    expect(templatesByCategory('recommended').every((t) => t.recommended)).toBe(true);
    expect(templatesByCategory('sync').every((t) => t.availability === 'p9')).toBe(true);
    expect(plainSentence(TEMPLATE_CATALOG[0]!)).not.toContain('*');
  });
});
