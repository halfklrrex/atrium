import { DOC_LIMITS } from '@atrium/shared';
import { describe, expect, it, vi } from 'vitest';
import { DOC_TOO_LONG, buildDocValue } from './doc-body';

vi.mock('../../lib/firebase', () => ({ db: {} }));

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

describe('buildDocValue', () => {
  it('keeps the doc and mirrors its text', () => {
    const result = buildDocValue({ type: 'doc', content: [para('Hello'), para('World')] });
    expect(result).toMatchObject({ ok: true, value: { text: 'Hello\nWorld' } });
  });

  it('still saves an empty doc, so clearing the text sticks', () => {
    const result = buildDocValue({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(result).toMatchObject({ ok: true, value: { text: '' } });
  });

  it('cuts the text mirror to its limit', () => {
    const result = buildDocValue({
      type: 'doc',
      content: [para('a'.repeat(DOC_LIMITS.text + 10))],
    });
    expect(result.ok && result.value?.text.length).toBe(DOC_LIMITS.text);
  });

  it('refuses a body over the size cap', () => {
    const big = { type: 'doc', content: [para('a'.repeat(DOC_LIMITS.bodyBytes + 1))] };
    expect(buildDocValue(big)).toEqual({ ok: false, message: DOC_TOO_LONG });
  });
});
