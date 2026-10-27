import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DescriptionEditor from './DescriptionEditor';

const text = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const DOC = {
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [text('Done')] },
        { type: 'taskItem', attrs: { checked: false }, content: [text('To do')] },
      ],
    },
  ],
};

describe('DescriptionEditor checklist', () => {
  it('renders checked and unchecked task items with data-checked', async () => {
    const { container } = render(
      <DescriptionEditor initial={DOC} readOnly onSave={vi.fn().mockResolvedValue(undefined)} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll('ul[data-type="taskList"] > li')).toHaveLength(2);
    });
    const items = container.querySelectorAll('ul[data-type="taskList"] > li');
    expect(items[0]?.getAttribute('data-checked')).toBe('true');
    expect(items[1]?.getAttribute('data-checked')).toBe('false');
  });
});
