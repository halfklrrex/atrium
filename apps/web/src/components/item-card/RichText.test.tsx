import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText';
import { safeLinkHref } from './safe-link';
import { buildUpdateBody, mentionIdsInDoc } from './update-doc';

const text = (value: string, ...marks: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks } : {}),
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const mark = (type: string, attrs?: Record<string, unknown>) => ({
  type,
  ...(attrs ? { attrs } : {}),
});

describe('RichText', () => {
  it('renders each mark', () => {
    const { container } = render(
      <RichText
        doc={doc(
          para(
            text('bold', mark('bold')),
            text('italic', mark('italic')),
            text('under', mark('underline')),
            text('strike', mark('strike')),
            text('code', mark('code')),
            text('red', mark('textStyle', { color: 'red' })),
            text('marked', mark('highlight', { color: 'green' })),
          ),
        )}
      />,
    );
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
    expect(screen.getByText('under').tagName).toBe('U');
    expect(screen.getByText('strike').tagName).toBe('S');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getByText('red')).toHaveClass('atrium-text-red');
    expect(screen.getByText('marked')).toHaveClass('atrium-highlight-green');
    expect(container.querySelector('script')).toBeNull();
  });

  it('ignores an unknown colour key and an unknown mark', () => {
    render(
      <RichText
        doc={doc(
          para(text('plain one', mark('textStyle', { color: 'red; background: url(x)' }))),
          para(text('plain two', mark('sparkle'))),
        )}
      />,
    );
    expect(screen.getByText('plain one').querySelector('[class]')).toBeNull();
    expect(screen.getByText('plain two').tagName).toBe('P');
  });

  it('renders paragraphs, hard breaks, quotes and every list kind', () => {
    const { container } = render(
      <RichText
        doc={doc(
          para(text('one'), { type: 'hardBreak' }, text('two')),
          { type: 'blockquote', content: [para(text('quoted'))] },
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [para(text('bullet'))] }],
          },
          {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [{ type: 'listItem', content: [para(text('numbered'))] }],
          },
          {
            type: 'taskList',
            content: [
              { type: 'taskItem', attrs: { checked: true }, content: [para(text('done'))] },
              { type: 'taskItem', attrs: { checked: false }, content: [para(text('todo'))] },
            ],
          },
        )}
      />,
    );
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
    expect(container.querySelector('ul > li')).toHaveTextContent('bullet');
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...boxes].map((b) => b.checked)).toEqual([true, false]);
    expect([...boxes].every((b) => b.disabled)).toBe(true);
  });

  it('renders a mention chip and an emoji', async () => {
    render(
      <RichText
        doc={doc(
          para({ type: 'mention', attrs: { id: 'u2', label: 'Jordan Lee' } }, text(' '), {
            type: 'emoji',
            attrs: { name: 'grinning' },
          }),
        )}
      />,
    );
    expect(screen.getByText('@Jordan Lee').className).toMatch(/mention/);
    await waitFor(() => expect(screen.getByTitle(':grinning:')).toHaveTextContent('😀'));
  });

  it('links only http, https and mailto, opened safely', () => {
    render(
      <RichText
        doc={doc(
          para(text('web', mark('link', { href: 'https://example.com/a' }))),
          para(text('mail', mark('link', { href: 'mailto:avery@example.com' }))),
          para(text('evil', mark('link', { href: 'javascript:alert(1)' }))),
          para(text('data', mark('link', { href: 'data:text/html,<b>x</b>' }))),
          para(text('relative', mark('link', { href: '/boards/1' }))),
        )}
      />,
    );
    const web = screen.getByRole('link', { name: 'web' });
    expect(web).toHaveAttribute('href', 'https://example.com/a');
    expect(web).toHaveAttribute('target', '_blank');
    expect(web).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute(
      'href',
      'mailto:avery@example.com',
    );
    // The text stays, but is not a link.
    for (const name of ['evil', 'data', 'relative']) {
      expect(screen.getByText(name).closest('a')).toBeNull();
    }
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('shows an unknown node as its text only, and never as HTML', () => {
    const { container } = render(
      <RichText
        doc={doc(
          { type: 'heading', attrs: { level: 1 }, content: [text('Big <b>news</b>')] },
          { type: 'wobble', content: [para(text('inside')), para(text('more'))] },
          para(text('<img src=x onerror=alert(1)>')),
        )}
      />,
    );
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('b, img')).toBeNull();
    expect(container).toHaveTextContent('Big <b>news</b>insidemore<img src=x onerror=alert(1)>');
  });

  it('renders nothing harmful for a malformed doc', () => {
    const { container } = render(<RichText doc={{ type: 'doc', content: [null, 4, 'x', {}] }} />);
    expect(container.textContent).toBe('');
  });
});

describe('safeLinkHref', () => {
  it('accepts web and mail links only', () => {
    expect(safeLinkHref('https://example.com')).toBe('https://example.com/');
    expect(safeLinkHref(' http://example.com ')).toBe('http://example.com/');
    expect(safeLinkHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(safeLinkHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeLinkHref('ftp://example.com')).toBeNull();
    expect(safeLinkHref(undefined)).toBeNull();
  });
});

describe('buildUpdateBody', () => {
  it('returns null for an empty or blank doc', () => {
    expect(buildUpdateBody(doc(para()))).toBeNull();
    expect(buildUpdateBody(doc(para(text('   '))))).toBeNull();
  });

  it('mirrors the text and lists each mention once', () => {
    const chip = (id: string, label: string) => ({ type: 'mention', attrs: { id, label } });
    const body = buildUpdateBody(
      doc(para(text('Hi '), chip('u2', 'Jordan Lee'), text(' and '), chip('u2', 'Jordan Lee'))),
    );
    expect(body?.content).toBe('Hi @Jordan Lee and @Jordan Lee');
    expect(body?.mentions).toEqual(['u2']);
  });

  it('caps the mentions at 20', () => {
    const chips = Array.from({ length: 25 }, (_, i) => ({
      type: 'mention',
      attrs: { id: `u${i}`, label: `Member ${i}` },
    }));
    expect(mentionIdsInDoc(doc(para(...chips)))).toHaveLength(20);
  });

  it('turns an emoji into its :name: and a hard break into a new line', () => {
    const body = buildUpdateBody(
      doc(
        para(text('a'), { type: 'hardBreak' }, text('b'), {
          type: 'emoji',
          attrs: { name: 'fire' },
        }),
      ),
    );
    expect(body?.content).toBe('a\nb:fire:');
  });
});
