import { describe, expect, it } from 'vitest';
import { isEmptyDoc } from '../item-view/description';
import { buildUpdateBody } from './update-doc';

const text = (value: string) => ({ type: 'text', text: value });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('buildUpdateBody: tables, code, dividers and layout keys', () => {
  const cellOf = (value: string) => ({
    type: 'tableCell',
    content: [para(text(value))],
  });
  const row = (...values: string[]) => ({ type: 'tableRow', content: values.map(cellOf) });

  it('mirrors a post that is only a table: cells joined with spaces, rows with newlines', () => {
    const body = buildUpdateBody(doc({ type: 'table', content: [row('a', 'b'), row('c', 'd')] }));
    expect(body?.content).toBe('a b\nc d');
  });

  it('mirrors a post that is only a code block', () => {
    const body = buildUpdateBody(doc({ type: 'codeBlock', content: [text('npm test')] }));
    expect(body?.content).toBe('npm test');
  });

  it('mirrors a heading with the text around a divider', () => {
    const body = buildUpdateBody(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] },
        { type: 'horizontalRule' },
        para(text('Go')),
      ),
    );
    expect(body?.content).toBe('Plan\nGo');
  });

  it('treats a lone divider, or a table with no text, as empty', () => {
    expect(buildUpdateBody(doc({ type: 'horizontalRule' }))).toBeNull();
    expect(buildUpdateBody(doc({ type: 'table', content: [row('', '')] }))).toBeNull();
  });

  it('counts a lone table as non-empty for the editor', () => {
    expect(isEmptyDoc(doc({ type: 'table', content: [row('', '')] }))).toBe(false);
  });

  it('leaves unset align and dir out of the stored doc, and keeps set ones', () => {
    const body = buildUpdateBody(
      doc(
        { type: 'paragraph', attrs: { align: null, dir: null }, content: [text('plain')] },
        { type: 'paragraph', attrs: { align: 'center', dir: null }, content: [text('mid')] },
        { type: 'heading', attrs: { level: 2, align: null, dir: null }, content: [text('H')] },
      ),
    );
    expect(body?.contentDoc).toEqual(
      doc(
        para(text('plain')),
        { type: 'paragraph', attrs: { align: 'center' }, content: [text('mid')] },
        { type: 'heading', attrs: { level: 2 }, content: [text('H')] },
      ),
    );
  });
});

describe('buildUpdateBody: pasted images', () => {
  const image = { type: 'image', attrs: { fileId: 'f1', alt: '', width: null } };

  it('lets a post with only an image be sent, mirrored as [Image], and keeps the node', () => {
    const body = buildUpdateBody(doc(image));
    expect(body?.content).toBe('[Image]');
    expect(body?.contentDoc).toEqual(doc(image));
  });

  it('keeps the text around an image in the mirror', () => {
    const body = buildUpdateBody(doc(para(text('See')), image));
    expect(body?.content).toBe('See\n[Image]');
  });

  it('still drops an upload placeholder', () => {
    expect(buildUpdateBody(doc({ type: 'imageUpload', attrs: { uploadId: 'u' } }))).toBeNull();
  });
});
