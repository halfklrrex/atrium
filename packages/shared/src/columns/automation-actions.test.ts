import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_ONLY_ACTION_TYPES,
  BUTTON_ACTION_LABELS,
  BUTTON_LIMITS,
  buttonActionSchema,
  buttonSettingsSchema,
  validateButtonActions,
} from '../index';

const col = (id: string, type: string, extra: object = {}) => ({
  id,
  type,
  title: id,
  settings: {},
  ...extra,
});
const board = {
  columns: [
    col('text', 'text'),
    col('num', 'numbers'),
    col('btn', 'button'),
    col('files', 'files'),
    col('calc', 'formula'),
    col('mig', 'text', { migrating: { toType: 'numbers' } }),
    col('locked', 'text'),
  ],
  groups: [{ id: 'g1' }],
  columnLocks: ['locked'],
};
const check = (action: object, role: 'owner' | 'editor' | null = 'editor', automation = true) =>
  validateButtonActions(
    [action as never],
    board,
    role,
    undefined,
    automation ? { automation } : {},
  );

describe('create_item / post_update schemas', () => {
  it('are the automation-only types and have labels', () => {
    expect([...AUTOMATION_ONLY_ACTION_TYPES]).toEqual(['create_item', 'post_update']);
    expect(BUTTON_ACTION_LABELS.create_item).toBe('Create item');
    expect(BUTTON_ACTION_LABELS.post_update).toBe('Post an update');
  });

  it('accepts valid create_item actions', () => {
    for (const a of [
      { type: 'create_item', name: 'Follow-up' },
      { type: 'create_item', name: '{name} follow-up {date}', groupId: 'g1' },
      { type: 'create_item', name: 'x'.repeat(500), values: { text: 'a', num: 3 } },
      {
        type: 'create_item',
        name: 'x',
        values: Object.fromEntries(
          Array.from({ length: BUTTON_LIMITS.maxCreateValues }, (_, i) => [`c${i}`, i]),
        ),
      },
    ]) {
      expect(buttonActionSchema.safeParse(a).success).toBe(true);
    }
  });

  it('refuses invalid create_item actions and caps', () => {
    for (const a of [
      { type: 'create_item' },
      { type: 'create_item', name: '' },
      { type: 'create_item', name: 'x'.repeat(501) },
      { type: 'create_item', name: 'x', groupId: 'g 1' },
      { type: 'create_item', name: 'x', extra: 1 },
      {
        type: 'create_item',
        name: 'x',
        values: Object.fromEntries(
          Array.from({ length: BUTTON_LIMITS.maxCreateValues + 1 }, (_, i) => [`c${i}`, i]),
        ),
      },
    ]) {
      expect(buttonActionSchema.safeParse(a).success).toBe(false);
    }
  });

  it('accepts and refuses post_update actions', () => {
    for (const a of [
      { type: 'post_update', text: 'Done: {name}' },
      { type: 'post_update', text: 'x'.repeat(2000) },
    ]) {
      expect(buttonActionSchema.safeParse(a).success).toBe(true);
    }
    for (const a of [
      { type: 'post_update' },
      { type: 'post_update', text: '' },
      { type: 'post_update', text: 'x'.repeat(2001) },
      { type: 'post_update', text: 'x', html: '<b>' },
    ]) {
      expect(buttonActionSchema.safeParse(a).success).toBe(false);
    }
  });
});

describe('validateButtonActions with the automation-only actions', () => {
  it('accepts them in an automation', () => {
    expect(check({ type: 'post_update', text: 'hi' })).toEqual({ ok: true });
    expect(check({ type: 'create_item', name: 'x', groupId: 'g1', values: { text: 'a' } })).toEqual(
      { ok: true },
    );
  });

  it('refuses them for a button column', () => {
    for (const a of [
      { type: 'post_update', text: 'hi' },
      { type: 'create_item', name: 'x' },
    ]) {
      const r = check(a, 'editor', false);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('only available in automations');
    }
  });

  it('keeps them out of a button column setting', () => {
    for (const action of [
      { type: 'post_update', text: 'hi' },
      { type: 'create_item', name: 'x' },
    ]) {
      expect(buttonSettingsSchema.safeParse({ actions: [action] }).success).toBe(false);
    }
    expect(buttonSettingsSchema.safeParse({ actions: [{ type: 'archive_item' }] }).success).toBe(
      true,
    );
  });

  it.each([
    [{ type: 'create_item', name: 'x', groupId: 'gone' }, 'group no longer exists'],
    [{ type: 'create_item', name: 'x', values: { nope: 1 } }, 'no longer exists'],
    [{ type: 'create_item', name: 'x', values: { btn: {} } }, 'button'],
    [{ type: 'create_item', name: 'x', values: { files: {} } }, 'managed'],
    [{ type: 'create_item', name: 'x', values: { calc: 1 } }, 'calculated'],
    [{ type: 'create_item', name: 'x', values: { mig: 'a' } }, 'changing type'],
    [{ type: 'create_item', name: 'x', values: { locked: 'a' } }, 'locked'],
    [{ type: 'create_item', name: 'x', values: { num: 'abc' } }, ''],
  ])('refuses %j', (action, text) => {
    const r = check(action);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.index).toBe(0);
      expect(r.message).toContain('Create item');
      expect(r.message).toContain(text);
    }
  });

  it('lets an owner set a locked column on the new item', () => {
    expect(check({ type: 'create_item', name: 'x', values: { locked: 'a' } }, 'owner')).toEqual({
      ok: true,
    });
  });
});
