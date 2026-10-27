import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DescriptionEditor from './DescriptionEditor';

// With CSS modules off, `composes` is invisible. Real builds give a two-class string here.
vi.mock('./DescriptionEditor.module.css', () => ({
  default: new Proxy(
    { tableScroll: 'tableScroll atrium-scroll' },
    { get: (t, k) => (t as Record<string | symbol, string>)[k] ?? String(k) },
  ),
}));

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

describe('DescriptionEditor with a table', () => {
  it('renders a table whose scroll class is a composed class list', async () => {
    const row = (type: string, ...cells: string[]) => ({
      type: 'tableRow',
      content: cells.map((t) => ({ type, content: [para(t)] })),
    });
    const { container } = render(
      <DescriptionEditor
        readOnly={false}
        onSave={vi.fn().mockResolvedValue(undefined)}
        initial={{
          type: 'doc',
          content: [
            { type: 'table', content: [row('tableHeader', 'A', 'B'), row('tableCell', 'c', 'd')] },
          ],
        }}
      />,
    );
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    const wrapper = container.querySelector('.tableWrapper');
    expect(wrapper?.classList.contains('tableScroll')).toBe(true);
    expect(wrapper?.classList.contains('atrium-scroll')).toBe(true);
  });
});
