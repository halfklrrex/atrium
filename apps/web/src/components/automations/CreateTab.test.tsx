import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateTab } from './CreateTab';
import { buildTemplateInput, TEMPLATE_CATALOG, type StarterBoard } from './starter-recipes';

const board: StarterBoard = {
  columns: [
    {
      id: 'status',
      type: 'status',
      title: 'Status',
      settings: {
        labels: [
          { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
          { id: 'd', index: 1, label: 'Done', color: '#00c875' },
        ],
      },
    },
  ],
  groups: [{ id: 'g1', title: 'Done items' }],
};

const emptyBoard: StarterBoard = { columns: [], groups: [] };

const useButton = (sentence: string) =>
  screen.getByRole('button', { name: `Use template: ${sentence}` });

function setup(over: { board?: StarterBoard; isOwner?: boolean } = {}) {
  const onOpenBuilder = vi.fn();
  render(
    <CreateTab
      board={over.board ?? board}
      uid="u1"
      isOwner={over.isOwner ?? true}
      onOpenBuilder={onOpenBuilder}
    />,
  );
  return onOpenBuilder;
}

describe('CreateTab', () => {
  it('shows the basics and every category under Explore', () => {
    setup();
    expect(screen.getByText('Start with the basics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create from scratch' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    for (const name of ['Recommended', 'Productivity', 'Communication', 'Dates & deadlines']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('filters by category from the sidebar', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Dates & deadlines' }));
    expect(screen.queryByText('Start with the basics')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Dates & deadlines' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Productivity' })).toBeNull();
    expect(screen.getByText(/arrives notify/)).toBeInTheDocument();
  });

  it('searches by sentence text and reports no matches', async () => {
    setup();
    const search = screen.getByLabelText('Search templates');
    fireEvent.change(search, { target: { value: 'archive' } });
    await waitFor(() => expect(screen.queryByText('Start with the basics')).toBeNull());
    expect(useButton('When status changes to Done archive the item')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(await screen.findByText('No templates match.')).toBeInTheDocument();
  });

  it('hides non-ready templates with the Hide coming soon switch', () => {
    setup();
    expect(screen.getAllByText('Soon · P5c').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Hide coming soon' }));
    expect(screen.queryByText('Soon · P5c')).toBeNull();
    expect(screen.queryByText('Planned · P9')).toBeNull();
    expect(useButton('When status changes to Done archive the item')).toBeInTheDocument();
  });

  it('opens the builder prefilled when a ready template is used', () => {
    const onOpenBuilder = setup();
    const template = TEMPLATE_CATALOG.find((t) => t.id === 'done-archives')!;
    fireEvent.click(useButton('When status changes to Done archive the item'));
    expect(onOpenBuilder).toHaveBeenCalledWith(buildTemplateInput(template, board, 'u1'));
    expect(onOpenBuilder.mock.calls[0]?.[0]?.actions).toEqual([{ type: 'archive_item' }]);
  });

  it('opens a blank builder from scratch', () => {
    const onOpenBuilder = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Create from scratch' }));
    expect(onOpenBuilder).toHaveBeenCalledWith();
  });

  it('shows a note instead of opening the builder when the board does not fit', () => {
    const onOpenBuilder = setup({ board: emptyBoard });
    fireEvent.click(useButton('When status changes to Done archive the item'));
    expect(onOpenBuilder).not.toHaveBeenCalled();
    expect(screen.getByText(/no column or group that fits/)).toBeInTheDocument();
  });

  it('disables templates that are not ready', () => {
    setup();
    expect(useButton('When a date arrives notify someone')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('is read-only for non-owners', () => {
    const onOpenBuilder = setup({ isOwner: false });
    expect(screen.getByText(/Only board owners can use templates/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create from scratch' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(useButton('When status changes to Done archive the item')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(onOpenBuilder).not.toHaveBeenCalled();
  });
});
