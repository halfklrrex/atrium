import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_LIMITS,
  BUTTON_LIMITS,
  automationConditionSchema,
  automationRunSchema,
  automationSchema,
  automationTriggerSchema,
  itemSchema,
  validateAutomation,
} from '../index';

const ts = (ms: number) => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

const recipe = (overrides: Record<string, unknown> = {}) => ({
  name: 'Done means archived',
  enabled: true,
  trigger: { type: 'status_changed', columnId: 'stat', toLabelId: 1 },
  conditions: [{ columnId: 'text', op: 'is_not_empty' }],
  actions: [{ type: 'archive_item' }],
  runAs: 'u1',
  disabledReason: null,
  createdBy: 'u1',
  createdAt: ts(1),
  updatedBy: 'u1',
  updatedAt: ts(2),
  ...overrides,
});

describe('limits', () => {
  it('match the decisions of the P5a spec', () => {
    expect(AUTOMATION_LIMITS).toMatchObject({
      maxPerBoard: 20,
      maxConditions: 3,
      maxActions: BUTTON_LIMITS.maxActions,
      maxRunsPerHour: 100,
      maxDepth: 3,
      runTtlDays: 30,
      name: 80,
    });
  });
});

describe('automationTriggerSchema', () => {
  it('accepts the three first triggers', () => {
    for (const t of [
      { type: 'item_created' },
      { type: 'item_created', groupId: 'g1' },
      { type: 'status_changed', columnId: 'stat' },
      { type: 'status_changed', columnId: 'stat', toLabelId: 0 },
      { type: 'button_clicked', columnId: 'btn' },
      { type: 'item_moved' },
      { type: 'item_moved', groupId: 'g1' },
      { type: 'person_assigned', columnId: 'who' },
      { type: 'person_assigned', columnId: 'who', uid: 'u2' },
    ]) {
      expect(automationTriggerSchema.safeParse(t).success).toBe(true);
    }
  });

  it('refuses unknown types, missing columns and extra keys', () => {
    for (const t of [
      { type: 'date_arrives', columnId: 'd' },
      { type: 'status_changed' },
      { type: 'button_clicked' },
      { type: 'item_created', columnId: 'x' },
      { type: 'status_changed', columnId: 'stat', toLabelId: -1 },
      { type: 'status_changed', columnId: 'stat', toLabelId: 'Done' },
      { type: 'item_moved', groupId: 'g 1' },
      { type: 'item_moved', columnId: 'x' },
      { type: 'person_assigned' },
      { type: 'person_assigned', uid: 'u2' },
      { type: 'person_assigned', columnId: 'who', uid: '' },
      { type: 'person_assigned', columnId: 'who', extra: 1 },
    ]) {
      expect(automationTriggerSchema.safeParse(t).success).toBe(false);
    }
  });
});

describe('automationConditionSchema', () => {
  const ok = (c: object) => automationConditionSchema.safeParse(c).success;

  it('needs a value for is and is_not only', () => {
    expect(ok({ columnId: 'c', op: 'is', value: 'x' })).toBe(true);
    expect(ok({ columnId: 'c', op: 'is_not', value: 0 })).toBe(true);
    expect(ok({ columnId: 'c', op: 'is' })).toBe(false);
    expect(ok({ columnId: 'c', op: 'is_not' })).toBe(false);
    expect(ok({ columnId: 'c', op: 'is_empty' })).toBe(true);
    expect(ok({ columnId: 'c', op: 'is_not_empty' })).toBe(true);
    expect(ok({ columnId: 'c', op: 'contains', value: 'x' })).toBe(false);
  });
});

describe('automationSchema', () => {
  const ok = (overrides: Record<string, unknown>) =>
    automationSchema.safeParse(recipe(overrides)).success;

  it('accepts a recipe, with or without the server-written counter', () => {
    expect(ok({})).toBe(true);
    expect(ok({ consecutiveFailures: 3 })).toBe(true);
    expect(ok({ name: '', disabledReason: 'Paused' })).toBe(true);
  });

  it('limits conditions to 3, actions to 1..5 and the name to 80', () => {
    const cond = { columnId: 'text', op: 'is_empty' };
    expect(ok({ conditions: [cond, cond, cond] })).toBe(true);
    expect(ok({ conditions: [cond, cond, cond, cond] })).toBe(false);
    expect(ok({ actions: [] })).toBe(false);
    expect(ok({ actions: Array.from({ length: 6 }, () => ({ type: 'archive_item' })) })).toBe(
      false,
    );
    expect(ok({ name: 'x'.repeat(81) })).toBe(false);
    expect(ok({ disabledReason: 'x'.repeat(201) })).toBe(false);
  });

  it('reuses the button action schema and refuses unknown actions', () => {
    expect(
      ok({
        actions: [
          { type: 'notify', uids: ['u2'] },
          { type: 'move_to_group', groupId: 'g1' },
        ],
      }),
    ).toBe(true);
    expect(ok({ actions: [{ type: 'send_email' }] })).toBe(false);
  });
});

describe('automationRunSchema', () => {
  const run = (overrides: Record<string, unknown> = {}) => ({
    automationId: 'a1',
    eventId: 'e1',
    itemId: 'i1',
    status: 'ok',
    actions: ['archive_item'],
    startedAt: ts(1),
    durationMs: 20,
    depth: 0,
    expiresAt: ts(2),
    ...overrides,
  });
  const ok = (overrides: Record<string, unknown> = {}) =>
    automationRunSchema.safeParse(run(overrides)).success;

  it('accepts ok, skipped (with a reason) and failed (with an error) runs', () => {
    expect(ok()).toBe(true);
    expect(ok({ status: 'skipped', reason: 'rate limit', actions: [] })).toBe(true);
    expect(ok({ status: 'failed', error: 'column locked' })).toBe(true);
  });

  it('accepts a pending and a delivered notification record', () => {
    const delivery = {
      kind: 'notify',
      creatorUid: 'u1',
      recipeName: 'Ship it',
      itemName: 'Task',
      targets: [{ uid: 'u2', message: 'Look' }],
    };
    expect(ok({ delivery, delivered: false })).toBe(true);
    expect(
      ok({ delivery: { ...delivery, kind: 'disabled', targets: undefined }, delivered: true }),
    ).toBe(true);
    expect(ok({ delivery: { ...delivery, kind: 'sms' } })).toBe(false);
    expect(ok({ delivered: 'yes' })).toBe(false);
  });

  it('refuses an unknown status, depth over 3 and over-long text', () => {
    expect(ok({ status: 'running' })).toBe(false);
    expect(ok({ depth: 4 })).toBe(false);
    expect(ok({ error: 'x'.repeat(201) })).toBe(false);
  });
});

describe('item automation marker', () => {
  it('is optional and nullable on the item', () => {
    const item = {
      name: 'Task',
      groupId: 'g1',
      position: 'a0',
      parentItemId: null,
      values: {},
      state: 'active',
      deletedAt: null,
      createdAt: ts(1),
      createdBy: 'u1',
      updatedAt: ts(2),
      updatedBy: 'u1',
    };
    const ok = (extra: object) => itemSchema.safeParse({ ...item, ...extra }).success;
    expect(ok({})).toBe(true);
    expect(ok({ updatedVia: null, automationDepth: null })).toBe(true);
    expect(ok({ updatedVia: 'automation:a1', automationDepth: 2 })).toBe(true);
    expect(ok({ automationRunId: 'a1-e1' })).toBe(true);
    expect(ok({ automationRunId: null })).toBe(true);
    expect(ok({ automationDepth: 4 })).toBe(false);
  });
});

describe('validateAutomation', () => {
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
      col('stat', 'status', {
        settings: { labels: [{ index: 1, label: 'Done', color: '#00c875' }] },
      }),
      col('btn', 'button'),
      col('calc', 'formula'),
      col('who', 'people'),
    ],
    groups: [{ id: 'g1' }],
    columnLocks: [],
    memberUids: ['u1', 'u2'],
  };
  const base = () => ({
    trigger: { type: 'status_changed' as const, columnId: 'stat', toLabelId: 1 },
    conditions: [{ columnId: 'text', op: 'is_not_empty' as const }] as never[],
    actions: [{ type: 'move_to_group' as const, groupId: 'g1' }] as never[],
  });
  const withTrigger = (trigger: object) => ({ ...base(), trigger: trigger as never });

  it('accepts a valid recipe', () => {
    expect(validateAutomation(base(), board, 'owner')).toEqual({ ok: true });
    expect(
      validateAutomation(withTrigger({ type: 'button_clicked', columnId: 'btn' }), board),
    ).toEqual({ ok: true });
    expect(validateAutomation(withTrigger({ type: 'item_created', groupId: 'g1' }), board)).toEqual(
      {
        ok: true,
      },
    );
  });

  it('rejects a trigger on the wrong column type or a missing column or group', () => {
    for (const trigger of [
      { type: 'status_changed', columnId: 'text' },
      { type: 'button_clicked', columnId: 'stat' },
      { type: 'status_changed', columnId: 'nope' },
      { type: 'item_created', groupId: 'gone' },
    ]) {
      expect(validateAutomation(withTrigger(trigger), board).ok).toBe(false);
    }
  });

  it('validates the item_moved and person_assigned triggers', () => {
    for (const trigger of [
      { type: 'item_moved' },
      { type: 'item_moved', groupId: 'g1' },
      { type: 'person_assigned', columnId: 'who' },
      { type: 'person_assigned', columnId: 'who', uid: 'u2' },
    ]) {
      expect(validateAutomation(withTrigger(trigger), board)).toEqual({ ok: true });
    }
    for (const trigger of [
      { type: 'item_moved', groupId: 'gone' },
      { type: 'person_assigned', columnId: 'text' },
      { type: 'person_assigned', columnId: 'nope' },
      { type: 'person_assigned', columnId: 'who', uid: 'stranger' },
    ]) {
      const r = validateAutomation(withTrigger(trigger), board);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/^Trigger/);
    }
    // Without a member list the uid cannot be checked (the settings-time check).
    const { memberUids: _members, ...noMembers } = board;
    expect(
      validateAutomation(
        withTrigger({ type: 'person_assigned', columnId: 'who', uid: 'stranger' }),
        noMembers,
      ),
    ).toEqual({ ok: true });
  });

  it('accepts create_item and post_update, with the index of a bad one', () => {
    expect(
      validateAutomation(
        {
          ...base(),
          actions: [
            { type: 'create_item', name: '{name} follow-up', groupId: 'g1', values: { text: 'x' } },
            { type: 'post_update', text: 'Moved' },
          ] as never[],
        },
        board,
        'owner',
      ),
    ).toEqual({ ok: true });
    const bad = validateAutomation(
      {
        ...base(),
        actions: [
          { type: 'post_update', text: 'ok' },
          { type: 'create_item', name: 'x', groupId: 'gone' },
        ] as never[],
      },
      board,
    );
    expect(bad).toMatchObject({ ok: false, index: 1 });
  });

  it('allows one create_item per recipe', () => {
    expect(AUTOMATION_LIMITS.maxCreatedPerRun).toBe(1);
    const r = validateAutomation(
      {
        ...base(),
        actions: [
          { type: 'create_item', name: 'a' },
          { type: 'create_item', name: 'b' },
        ] as never[],
      },
      board,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Create item');
  });

  it('rejects conditions on missing, button or calculated columns, and a missing value on is', () => {
    const cond = (c: object) => validateAutomation({ ...base(), conditions: [c as never] }, board);
    expect(cond({ columnId: 'nope', op: 'is_empty' }).ok).toBe(false);
    expect(cond({ columnId: 'btn', op: 'is_empty' }).ok).toBe(false);
    expect(cond({ columnId: 'calc', op: 'is_empty' }).ok).toBe(false);
    const missing = cond({ columnId: 'text', op: 'is' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain('value');
    expect(cond({ columnId: 'text', op: 'is', value: 'x' })).toEqual({ ok: true });
  });

  it('rejects six actions and zero actions', () => {
    const six = Array.from({ length: 6 }, () => ({ type: 'archive_item' })) as never[];
    expect(validateAutomation({ ...base(), actions: six }, board).ok).toBe(false);
    expect(validateAutomation({ ...base(), actions: [] }, board).ok).toBe(false);
  });

  it('delegates the actions to validateButtonActions and reports the action index', () => {
    const r = validateAutomation(
      {
        ...base(),
        actions: [
          { type: 'archive_item' },
          { type: 'set_value', columnId: 'btn', value: 'x' },
        ] as never[],
      },
      board,
    );
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(
      validateAutomation(
        { ...base(), actions: [{ type: 'move_to_group', groupId: 'gone' }] as never[] },
        board,
      ).ok,
    ).toBe(false);
  });
});
