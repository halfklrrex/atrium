import { describe, expect, it } from 'vitest';
import {
  FORM_LIMITS,
  FORM_QUESTION_TYPES,
  askableQuestions,
  defaultFormSettings,
  formPublishProblems,
  formSettingsSchema,
  publicFormQuestions,
  validateFormAnswers,
  viewSettingsSchema,
  type FormColumn,
  type FormSettings,
} from './index';

const col = (id: string, type: string, settings: Record<string, unknown> = {}): FormColumn => ({
  id,
  type,
  settings,
});

const columns: FormColumn[] = [
  col('notes', 'text'),
  col('story', 'long_text'),
  col('qty', 'numbers', { unit: null, decimals: null }),
  col('stage', 'status', {
    labels: [
      { id: 's0', index: 0, label: 'New', color: '#579bfc', isDone: false },
      { id: 's1', index: 1, label: 'Done', color: '#00c875', isDone: true },
    ],
  }),
  col('tags', 'dropdown', {
    labels: [
      { id: 1, label: 'Red' },
      { id: 2, label: 'Blue' },
    ],
    limitSelect: false,
  }),
  col('due', 'date'),
  col('ok', 'checkbox'),
  col('mail', 'email'),
  col('tel', 'phone'),
  col('site', 'link'),
  col('stars', 'rating', { limit: 5, symbol: 'stars' }),
  col('who', 'people'),
  col('secret', 'files'),
  col('calc', 'formula'),
];

const settings = (extra: FormSettings['questions'] = [], over: Partial<FormSettings> = {}) =>
  ({
    ...defaultFormSettings('g1'),
    questions: [{ columnId: 'name', label: 'Name', required: true }, ...extra],
    ...over,
  }) satisfies FormSettings;

const q = (columnId: string, required = false) => ({ columnId, label: columnId, required });

describe('form settings schema', () => {
  it('accepts the default and a full form', () => {
    expect(formSettingsSchema.safeParse(defaultFormSettings('g1')).success).toBe(true);
    const full = settings(FORM_QUESTION_TYPES.map((t) => q(`c_${t}`)).slice(0, 5));
    expect(formSettingsSchema.safeParse(full).success).toBe(true);
  });

  it('refuses unknown keys, at the top and on a question', () => {
    expect(formSettingsSchema.safeParse({ ...settings(), extra: 1 }).success).toBe(false);
    const withExtra = settings([{ ...q('notes'), icon: 'x' } as never]);
    expect(formSettingsSchema.safeParse(withExtra).success).toBe(false);
  });

  it('allows 30 questions and refuses 31', () => {
    const many = (n: number) => settings(Array.from({ length: n - 1 }, (_, i) => q(`c${i}`)));
    expect(formSettingsSchema.safeParse(many(FORM_LIMITS.questions)).success).toBe(true);
    expect(formSettingsSchema.safeParse(many(FORM_LIMITS.questions + 1)).success).toBe(false);
  });

  it('needs the required name first and no repeated column', () => {
    const base = settings([q('notes')]);
    expect(formSettingsSchema.safeParse({ ...base, questions: [q('notes')] }).success).toBe(false);
    expect(
      formSettingsSchema.safeParse({
        ...base,
        questions: [q('notes'), { columnId: 'name', label: 'Name', required: true }],
      }).success,
    ).toBe(false);
    expect(
      formSettingsSchema.safeParse({
        ...base,
        questions: [{ columnId: 'name', label: 'Name', required: false }],
      }).success,
    ).toBe(false);
    expect(formSettingsSchema.safeParse(settings([q('notes'), q('notes')])).success).toBe(false);
  });

  it('enforces the text caps and belongs under view settings', () => {
    expect(formSettingsSchema.safeParse(settings([], { title: 'x'.repeat(121) })).success).toBe(
      false,
    );
    expect(formSettingsSchema.safeParse(settings([], { thankYou: 'x'.repeat(501) })).success).toBe(
      false,
    );
    const view = {
      filter: {
        personIds: [],
        filterGroup: { conjunction: 'and', conditions: [] },
        sortConditions: [],
        groupByColumnId: null,
      },
      hiddenColumnIds: [],
      form: settings(),
    };
    expect(viewSettingsSchema.safeParse(view).success).toBe(true);
  });
});

describe('askable questions and publish problems', () => {
  it('drops questions on missing, disallowed or migrating columns', () => {
    const s = settings([q('notes'), q('gone'), q('who'), q('calc'), q('secret'), q('qty')]);
    const migrating = [...columns, { ...col('mig', 'text'), migrating: { snapshotId: 'x' } }];
    const ids = askableQuestions({ questions: [...s.questions, q('mig')] }, migrating).map(
      (a) => a.question.columnId,
    );
    expect(ids).toEqual(['name', 'notes', 'qty']);
  });

  it('reports a deleted group, a missing column and a disallowed type', () => {
    const s = settings([q('notes'), q('gone'), q('who')]);
    const problems = formPublishProblems(s, { columns, groups: [{ id: 'g2' }] });
    expect(problems).toHaveLength(3);
    expect(
      formPublishProblems(settings([q('notes')]), { columns, groups: [{ id: 'g1' }] }),
    ).toEqual([]);
  });
});

describe('publicFormQuestions', () => {
  it('returns the name first and only the settings an input needs', () => {
    const out = publicFormQuestions(
      settings([q('stage', true), q('tags'), q('qty'), q('stars'), q('notes')]),
      columns,
    );
    expect(out.map((o) => [o.columnId, o.type])).toEqual([
      ['name', 'name'],
      ['stage', 'status'],
      ['tags', 'dropdown'],
      ['qty', 'numbers'],
      ['stars', 'rating'],
      ['notes', 'text'],
    ]);
    expect(out[1]!.settings).toEqual({
      labels: [
        { id: 's0', index: 0, label: 'New', color: '#579bfc' },
        { id: 's1', index: 1, label: 'Done', color: '#00c875' },
      ],
    });
    expect(out[2]!.settings).toEqual({
      labels: [
        { id: 1, label: 'Red' },
        { id: 2, label: 'Blue' },
      ],
      limitSelect: false,
    });
    expect(out[3]!.settings).toEqual({ unit: null, decimals: null });
    expect(out[4]!.settings).toEqual({ limit: 5, symbol: 'stars' });
    expect(out[5]!.settings).toEqual({});
  });
});

describe('validateFormAnswers', () => {
  const all = settings([
    q('notes'),
    q('story'),
    q('qty'),
    q('stage'),
    q('tags'),
    q('due'),
    q('ok'),
    q('mail'),
    q('tel'),
    q('site'),
    q('stars'),
  ]);

  // One valid answer per allowed question type.
  const valid: Record<string, unknown> = {
    name: '  Avery Quinn  ',
    notes: 'hello',
    story: { text: 'long story' },
    qty: 42,
    stage: { index: 1 },
    tags: { ids: [1, 2] },
    due: { date: '2026-11-05' },
    ok: { checked: 'true' },
    mail: { email: 'avery@example.com', text: 'avery@example.com' },
    tel: { phone: '+12125551234', countryShortName: 'US' },
    site: { url: 'https://example.com', text: 'Example' },
    stars: { rating: 4 },
  };

  it('accepts one valid answer per allowed question type and trims the name', () => {
    const result = validateFormAnswers(all, columns, valid);
    expect(result).toMatchObject({ ok: true, name: 'Avery Quinn' });
    if (result.ok)
      expect(Object.keys(result.values).sort()).toEqual(
        Object.keys(valid)
          .filter((k) => k !== 'name')
          .sort(),
      );
  });

  it.each([
    ['story', { text: 5 }],
    ['qty', 'abc'],
    ['stage', { index: 'x' }],
    ['tags', { ids: ['a'] }],
    ['due', { date: '2026-13-45' }],
    ['ok', { checked: 'maybe' }],
    ['mail', { email: 'nope' }],
    ['site', { url: 5 }],
    ['stars', { rating: 11 }],
  ])('refuses an invalid %s answer', (id, value) => {
    const result = validateFormAnswers(all, columns, { name: 'A', [id]: value });
    expect(result).toMatchObject({ ok: false, columnId: id });
  });

  it('refuses unknown, disallowed and derived column keys instead of ignoring them', () => {
    for (const key of ['nope', 'who', 'calc', 'secret']) {
      expect(validateFormAnswers(all, columns, { name: 'A', [key]: 'x' })).toMatchObject({
        ok: false,
        columnId: key,
      });
    }
  });

  it('checks the name length and type', () => {
    expect(validateFormAnswers(all, columns, {})).toMatchObject({ ok: false, columnId: 'name' });
    expect(validateFormAnswers(all, columns, { name: '   ' })).toMatchObject({ ok: false });
    expect(validateFormAnswers(all, columns, { name: 5 })).toMatchObject({ ok: false });
    expect(validateFormAnswers(all, columns, { name: 'x'.repeat(201) })).toMatchObject({
      ok: false,
    });
    expect(validateFormAnswers(all, columns, { name: 'x'.repeat(200) }).ok).toBe(true);
  });

  it('requires required answers by the registry emptiness rule', () => {
    const req = settings([q('notes', true), q('ok', true), q('stars', true), q('tags', true)]);
    const base = { name: 'A', notes: 'x', ok: { checked: 'true' }, stars: { rating: 2 } };
    expect(validateFormAnswers(req, columns, { ...base, tags: { ids: [1] } }).ok).toBe(true);
    for (const blank of [
      { notes: '   ' },
      { ok: { checked: 'false' } },
      { stars: { rating: 0 } },
      { tags: { ids: [] } },
    ]) {
      expect(
        validateFormAnswers(req, columns, { ...base, tags: { ids: [1] }, ...blank }),
      ).toMatchObject({ ok: false });
    }
    expect(validateFormAnswers(req, columns, { name: 'A' })).toMatchObject({ ok: false });
  });

  it('leaves empty optional answers out and caps the payload', () => {
    const result = validateFormAnswers(all, columns, { name: 'A', notes: '', qty: null });
    expect(result).toEqual({ ok: true, name: 'A', values: {} });
    const big = validateFormAnswers(all, columns, { name: 'A', notes: 'x'.repeat(60_000) });
    expect(big).toMatchObject({ ok: false, message: 'The response is too large.' });
  });
});
