import type { ColumnDef } from '@atrium/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../components/toast-store';
import { dependencyUi } from './dependency';
import type { CellContext } from './types';

const dummyColumn: ColumnDef = {
  id: 'c-dep',
  type: 'dependency',
  title: 'Dependency',
  position: 'a0',
  settings: { strict: false },
};

const boardItems = [
  { id: 'item-a', name: 'Design schema', parentItemId: null, values: {} },
  {
    id: 'item-b',
    name: 'Build API',
    parentItemId: null,
    values: { 'c-dep': { item_ids: ['item-a'] } },
  },
  { id: 'item-c', name: 'Write tests', parentItemId: null, values: {} },
  { id: 'item-d', name: 'Ship release', parentItemId: null, values: {} },
  { id: 'sub-1', name: 'Subitem task', parentItemId: 'item-a', values: {} },
];

const makeContext = (itemId = 'item-a'): CellContext => ({
  highlight: '',
  rowDone: false,
  canEdit: true,
  boardId: 'b-1',
  itemId,
  getItems: () => boardItems,
});

describe('dependency column UI', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('has popover editor configured on dependencyUi', () => {
    expect(dependencyUi.type).toBe('dependency');
    expect(dependencyUi.tone).toBe('orange');
    expect(dependencyUi.editor).toBe('popover');
    expect(dependencyUi.Editor).toBeDefined();
  });

  it('renders an empty cell when value is null or item_ids is empty', () => {
    const { container, rerender } = render(
      <dependencyUi.Cell
        value={null}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext()}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');

    rerender(
      <dependencyUi.Cell
        value={{ item_ids: [] }}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext()}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders linked item name chips and +N overflow when more than 2 items are linked', () => {
    const { rerender } = render(
      <dependencyUi.Cell
        value={{ item_ids: ['item-a', 'item-b', 'item-c'] }}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext('item-d')}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Design schema')).toBeInTheDocument();
    expect(screen.getByText('Build API')).toBeInTheDocument();
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();

    // Missing item falls back to "Unavailable item"
    rerender(
      <dependencyUi.Cell
        value={{ item_ids: ['missing-id'] }}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext('item-d')}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Unavailable item')).toBeInTheDocument();
  });

  it('lists board items excluding self and subitems, and filters by search query', async () => {
    const Editor = dependencyUi.Editor!;
    render(
      <Editor
        value={null}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext('item-c')}
        onChange={vi.fn()}
        onClose={vi.fn()}
        anchor={document.body}
        saveSettings={vi.fn()}
      />,
    );

    // Excludes self ("Write tests" / item-c) and subitems ("Subitem task" / sub-1)
    expect(screen.queryByRole('option', { name: 'Write tests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Subitem task' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Design schema' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Build API' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ship release' })).toBeInTheDocument();

    const input = screen.getByPlaceholderText('Search items…');
    await userEvent.type(input, 'ship');

    expect(screen.getByRole('option', { name: 'Ship release' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Design schema' })).not.toBeInTheDocument();
  });

  it('toggles items on and off, and calls onChange(null) when last item is removed', () => {
    const onChange = vi.fn();
    const Editor = dependencyUi.Editor!;

    const { rerender } = render(
      <Editor
        value={{ item_ids: ['item-a'] }}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext('item-c')}
        onChange={onChange}
        onClose={vi.fn()}
        anchor={document.body}
        saveSettings={vi.fn()}
      />,
    );

    // Add item-d ("Ship release")
    fireEvent.click(screen.getByRole('option', { name: 'Ship release' }));
    expect(onChange).toHaveBeenCalledWith({ item_ids: ['item-a', 'item-d'] });

    // Remove item-a via the selected pill button when it is the only item
    onChange.mockClear();
    rerender(
      <Editor
        value={{ item_ids: ['item-a'] }}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext('item-c')}
        onChange={onChange}
        onClose={vi.fn()}
        anchor={document.body}
        saveSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Design schema' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('prevents circular dependencies and shows a negative toast when adding a cycle', () => {
    const onChange = vi.fn();
    const Editor = dependencyUi.Editor!;

    // In boardItems, item-b ("Build API") already depends on item-a ("Design schema").
    // Editing item-a and clicking item-b would create a cycle: item-a -> item-b -> item-a.
    render(
      <Editor
        value={null}
        settings={{ strict: false }}
        column={dummyColumn}
        ctx={makeContext('item-a')}
        onChange={onChange}
        onClose={vi.fn()}
        anchor={document.body}
        saveSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: 'Build API' }));

    expect(onChange).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.type).toBe('negative');
    expect(toasts[0]?.text).toMatch(/Circular dependency detected/i);
  });
});
