import type { ColumnDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  checkDraft,
  conditionColumns,
  conditionOps,
  isDraftOk,
  type BuilderBoard,
} from './recipe-draft';

const col = (id: string, type: string, settings: unknown = {}): ColumnDef =>
  ({ id, type, title: id, position: 'a0', settings }) as ColumnDef;

const board: BuilderBoard = {
  columns: [
    col('status', 'status', { labels: [{ id: 'd', index: 1, label: 'Done', color: '#00c875' }] }),
    col('go', 'button', { label: 'Go', actions: [] }),
    col('notes', 'text'),
    col('amount', 'numbers'),
    col('when', 'date'),
    col('mirror', 'formula', { formula: '1' }),
    col('done', 'checkbox'),
  ],
  groups: [{ id: 'g1', title: 'One', color: '#00c875', position: 'a0' }],
};

describe('conditionColumns', () => {
  it('offers status, text, numbers and checkbox, never buttons, derived or other types', () => {
    expect(conditionColumns(board).map((c) => c.id)).toEqual(['status', 'notes', 'amount', 'done']);
  });
});

describe('conditionOps', () => {
  it('gives a checkbox two value-less operators', () => {
    expect(conditionOps('checkbox').map((o) => o.op)).toEqual(['is_not_empty', 'is_empty']);
    expect(conditionOps('text').map((o) => o.op)).toEqual([
      'is',
      'is_not',
      'is_empty',
      'is_not_empty',
    ]);
  });
});

describe('checkDraft', () => {
  const move = [{ type: 'move_to_group', groupId: 'g1' }] as const;

  it('accepts a valid recipe', () => {
    const problems = checkDraft(
      { trigger: { type: 'item_created' }, conditions: [], actions: [...move] },
      board,
      'owner',
      0,
    );
    expect(isDraftOk(problems, 1)).toBe(true);
  });

  it('is not ok without actions', () => {
    const problems = checkDraft(
      { trigger: { type: 'item_created' }, conditions: [], actions: [] },
      board,
      'owner',
      0,
    );
    expect(isDraftOk(problems, 0)).toBe(false);
  });

  it('puts a trigger failure on the trigger', () => {
    const problems = checkDraft(
      {
        trigger: { type: 'status_changed', columnId: 'notes' },
        conditions: [],
        actions: [...move],
      },
      board,
      'owner',
      0,
    );
    expect(problems.trigger).toContain('needs a status column');
    expect(isDraftOk(problems, 1)).toBe(false);
  });

  it('puts a condition failure on its condition', () => {
    const problems = checkDraft(
      {
        trigger: { type: 'item_created' },
        conditions: [
          { columnId: 'notes', op: 'is', value: 'x' },
          { columnId: 'notes', op: 'is' },
        ],
        actions: [...move],
      },
      board,
      'owner',
      0,
    );
    expect(problems.conditions).toEqual([null, 'a value is required']);
    expect(isDraftOk(problems, 1)).toBe(false);
  });

  it('puts an action failure on the right row', () => {
    const problems = checkDraft(
      {
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [...move, { type: 'move_to_group', groupId: 'gone' }],
      },
      board,
      'owner',
      0,
    );
    expect(problems.actions[0]).toBeNull();
    expect(problems.actions[1]).toBeTruthy();
  });

  it('asks to choose a blank column and enforces the per-board cap on a new recipe', () => {
    const blank = checkDraft(
      {
        trigger: { type: 'button_clicked', columnId: '' },
        conditions: [{ columnId: '', op: 'is' }],
        actions: [...move],
      },
      board,
      'owner',
      20,
    );
    expect(blank.trigger).toBe('Choose a Button column');
    expect(blank.conditions[0]).toBe('Choose a column');
    expect(blank.general).toContain('at most 20');
  });
});
