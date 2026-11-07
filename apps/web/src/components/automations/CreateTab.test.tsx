import { fireEvent, render, screen, within } from '@testing-library/react';
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
const soonButton = (sentence: string, long: string) =>
  screen.getByRole('button', { name: `Use template: ${sentence} (${long})` });

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
    expect(screen.getByRole('button', { name: /Create from scratch/ })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Recommended' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Productivity' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Communication' })).toBeNull();
  });

  it('shows a curated overview: basics plus four recommended and four productivity cards', () => {
    setup();
    const basics = screen.getByRole('region', { name: 'Start with the basics' });
    // Create from scratch + three catalog basics.
    expect(within(basics).getAllByRole('listitem')).toHaveLength(4);
    const recommended = screen.getByRole('region', { name: 'Recommended' });
    expect(within(recommended).getAllByRole('listitem', { name: '' }).length).toBeGreaterThan(0);
    expect(within(recommended).getByText('· 9 templates')).toBeInTheDocument();
    expect(
      within(recommended).getByText('Templates for the columns this board already has: Status.'),
    ).toBeInTheDocument();
    for (const name of ['Email', 'Calendar', 'Team chat']) {
      expect(within(recommended).getByText(name)).toBeInTheDocument();
    }
    const productivity = screen.getByRole('region', { name: 'Productivity' });
    expect(within(productivity).getAllByRole('button', { name: /^Use template/ })).toHaveLength(4);
  });

  it('opens a category from "Show more"', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show more Productivity templates' }));
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(nav).getByRole('button', { name: 'Productivity' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.queryByText('Start with the basics')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Use template/ }).length).toBeGreaterThan(4);
  });

  it('tags categories that are all unavailable as Planned and counts ready templates', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    expect(within(nav).getByRole('button', { name: /Integrations/ })).toHaveTextContent('Planned');
    expect(within(nav).getByRole('button', { name: /Connected/ })).toHaveTextContent('Planned');
    expect(within(nav).getByRole('button', { name: 'Dates & deadlines' })).not.toHaveTextContent(
      'Planned',
    );
    expect(screen.getByText(/templates work today\./)).toBeInTheDocument();
    expect(screen.getByText('Email, calendar and chat apps arrive with P9.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Integrations · Coming soon' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('explains the Integrations category with a banner', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    fireEvent.click(within(nav).getByRole('button', { name: /Integrations/ }));
    expect(screen.getByText(/Integrations are planned \(P9\)/)).toBeInTheDocument();
  });

  it('filters by category from the sidebar', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Dates & deadlines' }));
    expect(screen.queryByText('Start with the basics')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Dates & deadlines' })).toBeInTheDocument();
    expect(screen.getByText('· 3 templates')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Productivity' })).toBeNull();
    expect(screen.getByText(/arrives notify/)).toBeInTheDocument();
  });

  it('searches every template whatever the category and clears the selection', async () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    fireEvent.click(within(nav).getByRole('button', { name: /Integrations/ }));
    const search = screen.getByLabelText('Search templates');
    fireEvent.change(search, { target: { value: 'archive' } });
    expect(
      await screen.findByRole('heading', { name: 'Results for “archive”' }),
    ).toBeInTheDocument();
    expect(screen.getByText('· 1 template')).toBeInTheDocument();
    expect(useButton('When status changes to Done archive the item')).toBeInTheDocument();
    for (const b of within(nav).getAllByRole('button')) {
      expect(b).not.toHaveAttribute('aria-current');
    }
  });

  it('shows an empty state with actions when nothing matches the search', async () => {
    const onOpenBuilder = setup();
    const search = screen.getByLabelText('Search templates');
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(await screen.findByText('No templates match “zzzz”')).toBeInTheDocument();
    expect(screen.getByText(/Try “status”, “notify” or “group”/)).toBeInTheDocument();
    const empty = screen.getByRole('region', { name: 'No templates match “zzzz”' });
    fireEvent.click(within(empty).getByRole('button', { name: 'Create from scratch' }));
    expect(onOpenBuilder).toHaveBeenCalledWith();
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Start with the basics')).toBeInTheDocument();
  });

  it('hides non-ready templates with the Hide coming soon switch', () => {
    setup();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Categories' })).getByRole('button', {
        name: 'Productivity',
      }),
    );
    expect(screen.getAllByText('Soon · P5c').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Hide coming soon' }));
    expect(screen.queryByText('Soon · P5c')).toBeNull();
    expect(screen.queryByText('Planned · P9')).toBeNull();
    expect(useButton('When status changes to Done archive the item')).toBeInTheDocument();
  });

  it('says so when the switch, not the search, empties a category', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    fireEvent.click(within(nav).getByRole('button', { name: /Integrations/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Hide coming soon' }));
    expect(screen.getByText('Nothing here with “Hide coming soon” on')).toBeInTheDocument();
    expect(screen.queryByText(/No templates match/)).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: /Create from scratch/ }));
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
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    fireEvent.click(within(nav).getByRole('button', { name: /Integrations/ }));
    const card = soonButton('When an item is created send an email', 'Planned: integrations (P9)');
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(card).toHaveTextContent('Coming soon');
    expect(screen.getAllByText('Planned · P9')[0]).toHaveAttribute(
      'title',
      'Planned: integrations (P9)',
    );
  });

  it('shows the time-based templates as ready and no P5d badge', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: ' ' } });
    const nav = screen.getByRole('navigation', { name: 'Categories' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Dates & deadlines' }));
    expect(useButton('Every Monday create an item in a group')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(useButton('When a date arrives notify someone')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(screen.queryByText('Planned · P5d')).toBeNull();
  });

  it('is read-only for non-owners', () => {
    const onOpenBuilder = setup({ isOwner: false });
    expect(screen.getByText(/Only board owners can use templates/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create from scratch/ })).toBeDisabled();
    expect(useButton('When status changes to Done move the item to a group')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(onOpenBuilder).not.toHaveBeenCalled();
  });
});
