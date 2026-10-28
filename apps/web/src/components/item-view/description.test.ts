import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDescription, createDebouncer, docToText, isEmptyDoc } from './description';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});

describe('description helpers', () => {
  it('extracts plain text with a newline between blocks', () => {
    const d = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    };
    expect(docToText(d)).toBe('Title\nBody');
  });

  it('stores null for an empty doc, and a capped text otherwise', () => {
    expect(buildDescription(doc(''))).toEqual({ ok: true, value: null });
    const long = buildDescription(doc('a'.repeat(12_000)));
    expect(long.ok && long.value?.text.length).toBe(10_000);
  });

  it('refuses a doc over the size limit with a friendly message', () => {
    const big = {
      type: 'doc',
      content: Array.from({ length: 400 }, () => ({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x'.repeat(1000) }],
      })),
    };
    const result = buildDescription(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/too long/);
  });
});

describe('autosave debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs only the last scheduled save, after 800ms of quiet', () => {
    const d = createDebouncer(800);
    const save = vi.fn();
    d.schedule(() => save('a'));
    vi.advanceTimersByTime(500);
    d.schedule(() => save('b'));
    vi.advanceTimersByTime(500);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('b');
  });

  it('flushes a pending save at once and can cancel it', () => {
    const d = createDebouncer(800);
    const save = vi.fn();
    d.schedule(save);
    d.flush();
    expect(save).toHaveBeenCalledTimes(1);
    d.schedule(save);
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('docToText with tables and dividers', () => {
  const cell = (type: string, t: string) => ({
    type,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
  });
  it('includes table cell text, one cell per line, and nothing for a divider', () => {
    const d = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Qty')],
            },
            { type: 'tableRow', content: [cell('tableCell', 'Tea'), cell('tableCell', '2')] },
          ],
        },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    };
    expect(docToText(d)).toBe('Name\nQty\nTea\n2\nAfter');
  });
});

describe('isEmptyDoc with content nodes', () => {
  const wrap = (...content: unknown[]) => ({ type: 'doc', content });

  it('is not empty for an image without alt, a divider, an empty table or an emoji', () => {
    expect(isEmptyDoc(wrap({ type: 'image', attrs: { src: 'a.png' } }))).toBe(false);
    expect(isEmptyDoc(wrap({ type: 'horizontalRule' }))).toBe(false);
    expect(
      isEmptyDoc(
        wrap({
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [] }] }],
        }),
      ),
    ).toBe(false);
    expect(
      isEmptyDoc(wrap({ type: 'paragraph', content: [{ type: 'emoji', attrs: { name: 'tea' } }] })),
    ).toBe(false);
  });

  it('is empty for an empty doc, an empty paragraph or whitespace-only text', () => {
    expect(isEmptyDoc({ type: 'doc' })).toBe(true);
    expect(isEmptyDoc(doc(''))).toBe(true);
    expect(isEmptyDoc(doc('   \n '))).toBe(true);
  });

  it('treats an imageUpload placeholder alone as empty through buildDescription', () => {
    expect(buildDescription(wrap({ type: 'imageUpload' }))).toEqual({ ok: true, value: null });
  });

  it('keeps an image-only doc with empty text', () => {
    const image = { type: 'image', attrs: { src: 'a.png' } };
    const d = wrap(image);
    expect(buildDescription(d)).toEqual({ ok: true, value: { doc: d, text: '' } });
  });
});
