import { FORM_LIMITS, defaultFormSettings, type FormSettings } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  getFormForVisitor,
  hourOf,
  positionAfter,
  submitFormInTransaction,
  type FormBoardData,
  type FormCounts,
  type FormViewData,
  type FormsTx,
  type NewFormItem,
} from './forms';

const settings = (over: Partial<FormSettings> = {}): FormSettings => ({
  ...defaultFormSettings('g1'),
  title: 'Request',
  questions: [
    { columnId: 'name', label: 'Name', required: true },
    { columnId: 'notes', label: 'Notes', help: 'Anything else', required: false },
    { columnId: 'stage', label: 'Stage', required: false },
    { columnId: 'who', label: 'Who', required: false },
  ],
  acceptingResponses: true,
  ...over,
});

const board = (): FormBoardData => ({
  state: 'active',
  columns: [
    { id: 'notes', type: 'text', settings: {} },
    {
      id: 'stage',
      type: 'status',
      settings: { labels: [{ id: 's0', index: 0, label: 'New', color: '#579bfc' }] },
    },
    { id: 'who', type: 'people', settings: {} },
    { id: 'secret', type: 'text', settings: {} },
    { id: 'prio', type: 'text', settings: {}, defaultValue: 'normal' },
  ],
  groups: [
    { id: 'g0', position: 'a0' },
    { id: 'g1', position: 'a1' },
  ],
});

function fakeStore(opts: { view?: Partial<FormViewData> | null; board?: FormBoardData | null }) {
  const created: Array<{ id: string; item: NewFormItem }> = [];
  const counters = new Map<string, number>();
  const view: FormViewData | null =
    opts.view === null
      ? null
      : { type: 'form', ownerId: null, settings: { form: settings() }, ...opts.view };
  const key = (v: string, h: number, uid?: string) => `${v}:${h}:${uid ?? '*'}`;
  let nowMs = Date.UTC(2026, 10, 5, 10, 30);
  const expiries: number[] = [];
  const store: FormsTx & {
    created: typeof created;
    counters: typeof counters;
    expiries: number[];
    advance(ms: number): void;
    lastPosition: string | null;
  } = {
    created,
    counters,
    expiries,
    lastPosition: 'a4',
    advance: (ms) => void (nowMs += ms),
    getView: async () => view,
    getBoard: async () => (opts.board === undefined ? board() : opts.board),
    getLastItemPosition: async () => store.lastPosition,
    getCounts: async (_b, v, uid, h): Promise<FormCounts> => ({
      person: counters.get(key(v, h, uid)) ?? 0,
      form: counters.get(key(v, h)) ?? 0,
    }),
    setCounts(_b, v, uid, h, counts, expiresAtMs) {
      counters.set(key(v, h, uid), counts.person);
      counters.set(key(v, h), counts.form);
      expiries.push(expiresAtMs);
    },
    newItemId: () => `item${created.length + 1}`,
    createItem: (_b, id, item) => void created.push({ id, item }),
    nowMs: () => nowMs,
  };
  return store;
}

const req = (answers: Record<string, unknown>) => ({
  boardId: 'b1',
  viewId: 'v1',
  answers,
});

describe('getFormForVisitor', () => {
  it('returns only the safe shape', async () => {
    const result = await getFormForVisitor(fakeStore({}), { boardId: 'b1', viewId: 'v1' });
    expect(Object.keys(result).sort()).toEqual(['description', 'questions', 'thankYou', 'title']);
    expect(result.questions.map((q) => q.columnId)).toEqual(['name', 'notes', 'stage']);
    expect(result.questions[1]).toEqual({
      columnId: 'notes',
      label: 'Notes',
      help: 'Anything else',
      required: false,
      type: 'text',
      settings: {},
    });
    expect(result.questions[2]!.settings).toEqual({
      labels: [{ id: 's0', index: 0, label: 'New', color: '#579bfc' }],
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|g0|targetGroup|acceptingResponses/);
  });

  it.each([
    ['the form is off', { view: { settings: { form: settings({ acceptingResponses: false }) } } }],
    ['the view is not a form', { view: { type: 'table' } }],
    ['the view is personal', { view: { ownerId: 'someone' } }],
    ['the view is missing', { view: null }],
    ['the settings are broken', { view: { settings: { form: { title: 1 } } } }],
    ['the board is deleted', { board: { ...board(), state: 'deleted' } }],
    ['the board is missing', { board: null }],
  ])('fails with the same not-found when %s', async (_name, opts) => {
    await expect(
      getFormForVisitor(fakeStore(opts), { boardId: 'b1', viewId: 'v1' }),
    ).rejects.toMatchObject({ code: 'not-found', message: 'This form is not available.' });
  });
});

describe('submitFormInTransaction', () => {
  it('creates one item at the end of the target group and returns no item id', async () => {
    const store = fakeStore({});
    const result = await submitFormInTransaction(
      store,
      'visitor',
      req({ name: ' Hello ', notes: 'hi', stage: { index: 0 } }),
    );
    expect(result).toEqual({ ok: true, thankYou: 'Thanks, your response was recorded.' });
    expect(store.created).toHaveLength(1);
    expect(store.created[0]!.item).toEqual({
      name: 'Hello',
      groupId: 'g1',
      position: 'a5',
      values: { prio: 'normal', notes: 'hi', stage: { index: 0 } },
      createdBy: 'visitor',
    });
  });

  it('falls back to the first group when the target group is gone', async () => {
    const store = fakeStore({
      view: { settings: { form: settings({ targetGroupId: 'deleted' }) } },
    });
    await submitFormInTransaction(store, 'visitor', req({ name: 'A' }));
    expect(store.created[0]!.item.groupId).toBe('g0');
  });

  it('refuses unknown columns, disallowed columns, missing required answers and bad values', async () => {
    const store = fakeStore({});
    const bad = (answers: Record<string, unknown>) =>
      submitFormInTransaction(store, 'visitor', req(answers));
    await expect(bad({ name: 'A', secret: 'x' })).rejects.toMatchObject({
      code: 'invalid-argument',
      details: { columnId: 'secret' },
    });
    await expect(bad({ name: 'A', who: { personsAndTeams: [] } })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(bad({})).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(bad({ name: 'A', stage: { index: 'x' } })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(bad({ name: 'A', notes: 5 })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      bad({ name: 'A', notes: 'x'.repeat(FORM_LIMITS.answersMaxBytes) }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(store.created).toHaveLength(0);
    expect(store.counters.size).toBe(0);
  });

  it.each([
    ['the form is off', { view: { settings: { form: settings({ acceptingResponses: false }) } } }],
    ['the view is not a form', { view: { type: 'kanban' } }],
    ['the board is gone', { board: null }],
  ])('refuses when %s', async (_name, opts) => {
    const store = fakeStore(opts);
    await expect(
      submitFormInTransaction(store, 'visitor', req({ name: 'A' })),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(store.created).toHaveLength(0);
  });

  it('limits one person to 10 an hour and lets the 11th wait for the next hour', async () => {
    const store = fakeStore({});
    for (let i = 0; i < FORM_LIMITS.perPersonPerHour; i += 1) {
      await submitFormInTransaction(store, 'visitor', req({ name: `n${i}` }));
    }
    await expect(
      submitFormInTransaction(store, 'visitor', req({ name: 'one too many' })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    // Someone else is unaffected.
    await submitFormInTransaction(store, 'other', req({ name: 'fine' }));
    expect(store.created).toHaveLength(FORM_LIMITS.perPersonPerHour + 1);
    store.advance(60 * 60 * 1000);
    await submitFormInTransaction(store, 'visitor', req({ name: 'next hour' }));
  });

  it('limits a form to 200 an hour across people', async () => {
    const store = fakeStore({});
    for (let i = 0; i < FORM_LIMITS.perFormPerHour; i += 1) {
      await submitFormInTransaction(store, `u${i}`, req({ name: `n${i}` }));
    }
    await expect(
      submitFormInTransaction(store, 'latecomer', req({ name: 'x' })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(store.created).toHaveLength(FORM_LIMITS.perFormPerHour);
  });

  it('sets counter expiry a day after the hour ends', async () => {
    const store = fakeStore({});
    await submitFormInTransaction(store, 'visitor', req({ name: 'A' }));
    const hour = hourOf(Date.UTC(2026, 10, 5, 10, 30));
    expect(store.expiries[0]).toBe((hour + 1) * 3_600_000 + 86_400_000);
  });
});

describe('positionAfter', () => {
  it('sorts after the given key in fractional-indexing form', () => {
    expect(positionAfter(null)).toBe('a0');
    expect(positionAfter('a0')).toBe('a1');
    expect(positionAfter('a9')).toBe('aA');
    expect(positionAfter('aZ')).toBe('aa');
    expect(positionAfter('az')).toBe('b00');
    expect(positionAfter('a1V')).toBe('a2');
    expect(positionAfter('b0z')).toBe('b10');
    expect(positionAfter('Zz')).toBe('a0');
    for (const key of ['a0', 'a1V', 'az', 'b99', 'a0G', 'Zy']) {
      expect(positionAfter(key) > key).toBe(true);
    }
  });
});
