import { describe, expect, it } from 'vitest';
import { attentionReason } from './attention';

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
