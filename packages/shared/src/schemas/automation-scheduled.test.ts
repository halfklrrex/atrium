import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_LIMITS,
  AUTOMATION_TRIGGER_LABELS,
  automationSchema,
  automationTriggerSchema,
  itemSchema,
  validateAutomation,
  validateScheduledLimit,
  type AutomationTrigger,
} from '../index';

const ts = (ms: number) => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

describe('scheduled trigger schemas', () => {
  it('accepts date_arrives with and without a time', () => {
    for (const t of [
      { type: 'date_arrives', columnId: 'due', offsetDays: -3 },
      { type: 'date_arrives', columnId: 'due', offsetDays: 0, at: '09:30' },
      { type: 'date_arrives', columnId: 'due', offsetDays: 30 },
      { type: 'date_arrives', columnId: 'due', offsetDays: -30 },
    ]) {
      expect(automationTriggerSchema.safeParse(t).success).toBe(true);
    }
  });

  it('refuses a bad date_arrives', () => {
    for (const t of [
      { type: 'date_arrives', columnId: 'due', offsetDays: 31 },
      { type: 'date_arrives', columnId: 'due', offsetDays: -31 },
      { type: 'date_arrives', columnId: 'due', offsetDays: 1.5 },
      { type: 'date_arrives', columnId: 'due' },
      { type: 'date_arrives', columnId: 'due', offsetDays: 0, at: '9:00' },
      { type: 'date_arrives', columnId: 'due', offsetDays: 0, at: '24:00' },
      { type: 'date_arrives', columnId: 'due', offsetDays: 0, extra: 1 },
    ]) {
      expect(automationTriggerSchema.safeParse(t).success).toBe(false);
    }
  });

  it('accepts and refuses recurring shapes', () => {
    for (const t of [
      { type: 'recurring', every: 'day', at: '09:00' },
      { type: 'recurring', every: 'week', weekday: 6, at: '23:59' },
      { type: 'recurring', every: 'month', dayOfMonth: 28, at: '00:00' },
    ]) {
      expect(automationTriggerSchema.safeParse(t).success).toBe(true);
    }
    for (const t of [
      { type: 'recurring', every: 'hour', at: '09:00' },
      { type: 'recurring', every: 'day' },
      { type: 'recurring', every: 'week', weekday: 7, at: '09:00' },
      { type: 'recurring', every: 'week', weekday: -1, at: '09:00' },
      { type: 'recurring', every: 'month', dayOfMonth: 29, at: '09:00' },
      { type: 'recurring', every: 'month', dayOfMonth: 0, at: '09:00' },
      { type: 'recurring', every: 'day', at: '9am' },
    ]) {
      expect(automationTriggerSchema.safeParse(t).success).toBe(false);
    }
  });

  it('has labels for both', () => {
    expect(AUTOMATION_TRIGGER_LABELS.date_arrives).toBe('Date arrives');
    expect(AUTOMATION_TRIGGER_LABELS.recurring).toBe('Recurring');
  });
});

describe('automation doc: timezone and nextRunAt', () => {
  const doc = (overrides: Record<string, unknown> = {}) => ({
    name: '',
    enabled: true,
    trigger: { type: 'recurring', every: 'day', at: '09:00' },
    conditions: [],
    actions: [{ type: 'create_item', name: 'Daily' }],
    runAs: 'u1',
    disabledReason: null,
    createdBy: 'u1',
    createdAt: ts(1),
    updatedBy: 'u1',
    updatedAt: ts(2),
    ...overrides,
  });

  it('accepts a canonical timezone and the server-written nextRunAt', () => {
    expect(
      automationSchema.safeParse(doc({ timezone: 'Europe/Madrid', nextRunAt: ts(5) })).success,
    ).toBe(true);
    expect(automationSchema.safeParse(doc({ timezone: 'UTC', nextRunAt: null })).success).toBe(
      true,
    );
  });

  it('stays valid without them (existing recipes) and refuses an unknown zone', () => {
    expect(automationSchema.safeParse(doc()).success).toBe(true);
    expect(automationSchema.safeParse(doc({ timezone: 'Mars/Olympus' })).success).toBe(false);
    expect(automationSchema.safeParse(doc({ timezone: '' })).success).toBe(false);
  });
});

describe('items: dateKeys is an optional server-maintained array', () => {
  it('is accepted by the item schema shape', () => {
    expect(itemSchema.shape.dateKeys.safeParse(['due:2026-11-30']).success).toBe(true);
    expect(itemSchema.shape.dateKeys.safeParse(undefined).success).toBe(true);
    expect(itemSchema.shape.dateKeys.safeParse('due:2026-11-30').success).toBe(false);
  });
});

describe('validateAutomation: scheduled triggers', () => {
  const col = (id: string, type: string) => ({ id, type, title: id, settings: {} });
  const board = {
    columns: [col('due', 'date'), col('text', 'text'), col('who', 'people')],
    groups: [{ id: 'g1' }],
    columnLocks: [],
    memberUids: ['u1'],
  };
  const notify = { type: 'notify' as const, uids: ['u1'] };
  const create = { type: 'create_item' as const, name: 'Weekly review {date}' };
  const dateRecipe = (trigger: AutomationTrigger, extra: object = {}) => ({
    trigger,
    conditions: [],
    actions: [notify] as never[],
    timezone: 'Europe/Madrid',
    ...extra,
  });

  it('date_arrives needs an existing date column', () => {
    const ok = dateRecipe({ type: 'date_arrives', columnId: 'due', offsetDays: -3 });
    expect(validateAutomation(ok, board).ok).toBe(true);

    const missing = validateAutomation(
      dateRecipe({ type: 'date_arrives', columnId: 'gone', offsetDays: 0 }),
      board,
    );
    expect(missing).toMatchObject({ ok: false, message: expect.stringContaining('no longer') });

    const wrongType = validateAutomation(
      dateRecipe({ type: 'date_arrives', columnId: 'text', offsetDays: 0 }),
      board,
    );
    expect(wrongType).toMatchObject({ ok: false, message: expect.stringContaining('date column') });
  });

  it('date_arrives may use item actions', () => {
    const r = dateRecipe(
      { type: 'date_arrives', columnId: 'due', offsetDays: 0 },
      { actions: [{ type: 'post_update', text: 'Due today' }] },
    );
    expect(validateAutomation(r, board).ok).toBe(true);
  });

  it('recurring needs weekday for week and dayOfMonth for month', () => {
    expect(
      validateAutomation(dateRecipe({ type: 'recurring', every: 'day', at: '09:00' }), board).ok,
    ).toBe(true);
    expect(
      validateAutomation(
        dateRecipe({ type: 'recurring', every: 'week', weekday: 1, at: '09:00' }),
        board,
      ).ok,
    ).toBe(true);
    expect(
      validateAutomation(
        dateRecipe({ type: 'recurring', every: 'month', dayOfMonth: 15, at: '09:00' }),
        board,
      ).ok,
    ).toBe(true);

    expect(
      validateAutomation(dateRecipe({ type: 'recurring', every: 'week', at: '09:00' }), board).ok,
    ).toBe(false);
    expect(
      validateAutomation(dateRecipe({ type: 'recurring', every: 'month', at: '09:00' }), board).ok,
    ).toBe(false);
    // A field that does not belong to the cadence is refused too.
    expect(
      validateAutomation(
        dateRecipe({ type: 'recurring', every: 'day', weekday: 1, at: '09:00' }),
        board,
      ).ok,
    ).toBe(false);
    expect(
      validateAutomation(
        dateRecipe({ type: 'recurring', every: 'week', weekday: 1, dayOfMonth: 3, at: '09:00' }),
        board,
      ).ok,
    ).toBe(false);
  });

  it('recurring allows only create_item and notify', () => {
    const trigger = { type: 'recurring', every: 'day', at: '09:00' } as const;
    expect(validateAutomation(dateRecipe(trigger, { actions: [create, notify] }), board).ok).toBe(
      true,
    );
    for (const action of [
      { type: 'set_value', columnId: 'text', value: 'x' },
      { type: 'post_update', text: 'hi' },
      { type: 'archive_item' },
      { type: 'rename_item', template: 'x' },
      { type: 'move_to_group', groupId: 'g1' },
    ]) {
      const res = validateAutomation(dateRecipe(trigger, { actions: [notify, action] }), board);
      expect(res).toMatchObject({ ok: false, index: 1 });
    }
  });

  it('requires a known timezone for scheduled triggers only', () => {
    const trigger = { type: 'recurring', every: 'day', at: '09:00' } as const;
    expect(validateAutomation(dateRecipe(trigger, { timezone: undefined }), board).ok).toBe(false);
    expect(validateAutomation(dateRecipe(trigger, { timezone: 'Mars/Olympus' }), board).ok).toBe(
      false,
    );
    expect(
      validateAutomation(
        {
          trigger: { type: 'item_created' },
          conditions: [],
          actions: [notify] as never[],
        },
        board,
      ).ok,
    ).toBe(true);
  });
});

describe('validateScheduledLimit', () => {
  const scheduled = { trigger: { type: 'recurring', every: 'day', at: '09:00' } } as const;
  const dated = {
    trigger: { type: 'date_arrives', columnId: 'due', offsetDays: 0 },
  } as const;
  const plain = { trigger: { type: 'item_created' } } as const;

  it('allows up to 5 scheduled recipes, counting both kinds, and ignores event recipes', () => {
    expect(AUTOMATION_LIMITS.maxScheduledPerBoard).toBe(5);
    const four = [scheduled, scheduled, dated, dated, plain, plain, plain];
    expect(validateScheduledLimit(scheduled, four).ok).toBe(true);
    const five = [...four, dated];
    expect(validateScheduledLimit(dated, five)).toMatchObject({ ok: false });
    expect(validateScheduledLimit(scheduled, five)).toMatchObject({ ok: false });
  });

  it('never blocks an event recipe', () => {
    const five = [scheduled, scheduled, scheduled, dated, dated];
    expect(validateScheduledLimit(plain, five).ok).toBe(true);
  });

  it('keeps the per-board total at 20', () => {
    expect(AUTOMATION_LIMITS.maxPerBoard).toBe(20);
  });
});
