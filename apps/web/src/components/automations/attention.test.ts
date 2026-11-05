import { describe, expect, it } from 'vitest';
import { attentionReason, filterNeedsAttention } from './attention';

const on = { enabled: true, disabledReason: null };

describe('attentionReason', () => {
  it('flags a breaker-disabled automation', () => {
    expect(attentionReason({ enabled: false, disabledReason: 'Failed 5 times' }, undefined)).toBe(
      'circuit-breaker',
    );
  });
  it('does not flag one the owner simply switched off', () => {
    expect(
      attentionReason({ enabled: false, disabledReason: null }, { status: 'failed' }),
    ).toBeNull();
  });
  it('flags an enabled automation whose newest run failed', () => {
    expect(attentionReason(on, { status: 'failed' })).toBe('failing');
  });
  it('ignores ok, skipped and missing runs', () => {
    expect(attentionReason(on, { status: 'ok' })).toBeNull();
    expect(attentionReason(on, { status: 'skipped' })).toBeNull();
    expect(attentionReason(on, undefined)).toBeNull();
  });
});

describe('filterNeedsAttention', () => {
  const list = [
    { id: 'a', ...on },
    { id: 'b', ...on },
    { id: 'c', enabled: false, disabledReason: 'Too many failures' },
  ];
  it('keeps failing and breaker-disabled ones in order', () => {
    const runs = new Map([['b', { status: 'failed' as const }]]);
    expect(filterNeedsAttention(list, runs).map((a) => a.id)).toEqual(['b', 'c']);
  });
  it('works without history (non-owners)', () => {
    expect(filterNeedsAttention(list, null).map((a) => a.id)).toEqual(['c']);
  });
});
