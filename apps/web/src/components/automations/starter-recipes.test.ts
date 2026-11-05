import { validateAutomation } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { buildStarterRecipes, type StarterBoard } from './starter-recipes';

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
