import { describe, expect, it } from 'vitest';
import { pickAutomations, toAutomationDoc } from './admin-automations';

const stored = (over: Record<string, unknown> = {}) => ({
  name: 'Ship it',
  enabled: true,
  runAs: 'creator',
  trigger: { type: 'item_created' },
  conditions: [],
  actions: [{ type: 'archive_item' }],
  ...over,
});

describe('toAutomationDoc', () => {
  it('parses a valid recipe', () => {
    const doc = toAutomationDoc('a1', stored());
    expect(doc.invalid).toBeUndefined();
    expect(doc.actions).toHaveLength(1);
  });

  it('marks a recipe with no actions, too many actions or too many conditions invalid', () => {
    const archive = { type: 'archive_item' };
    const cond = { columnId: 'c', op: 'is_empty' };
    expect(toAutomationDoc('a', stored({ actions: [] })).invalid).toBeDefined();
    expect(toAutomationDoc('a', stored({ actions: Array(6).fill(archive) })).invalid).toBeDefined();
    expect(
      toAutomationDoc('a', stored({ actions: Array(5).fill(archive) })).invalid,
    ).toBeUndefined();
    expect(toAutomationDoc('a', stored({ conditions: Array(4).fill(cond) })).invalid).toBeDefined();
    expect(
      toAutomationDoc('a', stored({ conditions: Array(3).fill(cond) })).invalid,
    ).toBeUndefined();
  });

  it('marks an unparseable trigger or a missing runAs invalid', () => {
    expect(toAutomationDoc('a', stored({ trigger: { type: 'nope' } })).invalid).toBeDefined();
    expect(toAutomationDoc('a', stored({ runAs: '' })).invalid).toBeDefined();
  });
});

describe('pickAutomations', () => {
  const doc = (id: string, invalid = false) => ({
    ...toAutomationDoc(id, stored()),
    ...(invalid ? { invalid: 'bad' } : {}),
  });

  it('keeps every invalid recipe and caps only the valid ones', () => {
    const docs = [
      doc('bad1', true),
      ...Array.from({ length: 25 }, (_, i) => doc(`v${i}`)),
      doc('bad2', true),
    ];
    const picked = pickAutomations(docs, 20);
    expect(picked.filter((a) => a.invalid === undefined)).toHaveLength(20);
    expect(picked.map((a) => a.id)).toEqual(expect.arrayContaining(['bad1', 'bad2']));
    expect(picked).toHaveLength(22);
  });
});
