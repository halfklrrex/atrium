import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeFolder } from '../../test/fixtures';
import { useUiStore } from '../AppShell/ui-store';
import { SidebarTree, type SidebarTreeProps } from './SidebarTree';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../boards/BoardMenu', () => ({
  BoardMenu: ({ board }: { board: { name: string } }) => (
    <button type="button" aria-label={`Options for ${board.name}`} />
  ),
}));

const folders = [
  makeFolder({ id: 'f2', name: 'Archive', position: 'a1', color: '#ffcb00' }),
  makeFolder({ id: 'f1', name: 'Planning', position: 'a0' }),
];
const boards = [
  makeBoard({ id: 'b2', name: 'Zeta board', position: 'a1' }),
  makeBoard({ id: 'b1', name: 'Alpha board', position: 'a0' }),
  makeBoard({ id: 'b3', name: 'Roadmap', folderId: 'f1', kind: 'private' }),
];

function renderTree(overrides: Partial<SidebarTreeProps> = {}, path = '/') {
  const props: SidebarTreeProps = {
    workspaceId: 'w1',
    folders,
    boards,
    activeBoardId: null,
    canManageFolders: true,
    canReorder: true,
    filter: '',
    expanded: new Set<string>(),
    onToggleFolder: vi.fn(),
    onRenameBoard: vi.fn(),
    onRenameFolder: vi.fn(),
    onDrop: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarTree {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe('SidebarTree', () => {
  it('lists folders first, then boards, each ordered by position', () => {
    renderTree();
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Planning');
    expect(items[1]).toHaveTextContent('Archive');
    expect(items[2]).toHaveTextContent('Alpha board');
    expect(items[3]).toHaveTextContent('Zeta board');
  });

  it('hides the boards of a collapsed folder and shows them when expanded', () => {
    renderTree();
    expect(screen.queryByText('Roadmap')).not.toBeInTheDocument();
  });

  it('renders the children of an expanded folder, one level deeper', () => {
    renderTree({ expanded: new Set(['f1']) });
    const child = screen.getByText('Roadmap').closest('[role="treeitem"]');
    expect(child).toHaveAttribute('aria-level', '2');
    expect(screen.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('href', '/boards/b3');
  });

  it('links boards to their page and marks the active one', () => {
    renderTree({ activeBoardId: 'b1' }, '/boards/b1');
    const active = screen.getByRole('link', { name: 'Alpha board' });
    expect(active).toHaveAttribute('href', '/boards/b1');
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Zeta board' })).not.toHaveAttribute('aria-current');
  });

  it('toggles folders on click and reports the folder id', async () => {
    const props = renderTree();
    await userEvent.click(screen.getByRole('button', { name: 'Planning' }));
    expect(props.onToggleFolder).toHaveBeenCalledWith('f1');
  });

  it('shows how many boards a folder holds', () => {
    renderTree();
    expect(screen.getByLabelText('1 boards')).toBeInTheDocument();
    expect(screen.getByLabelText('0 boards')).toBeInTheDocument();
  });

  it('filters by board name, opening the folders that contain a match', () => {
    renderTree({ filter: 'road' });
    expect(screen.getByText('Roadmap')).toBeInTheDocument();
    expect(screen.queryByText('Alpha board')).not.toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('says so when nothing matches or the workspace is empty', () => {
    renderTree({ filter: 'zzz' });
    expect(screen.getByText('No boards match your search.')).toBeInTheDocument();
  });

  it('shows an empty note without boards or folders', () => {
    renderTree({ folders: [], boards: [] });
    expect(screen.getByText('No boards yet')).toBeInTheDocument();
  });

  it('offers to create a board when the workspace is empty', async () => {
    useUiStore.setState({ dialog: null });
    renderTree({ folders: [], boards: [] });
    await userEvent.click(screen.getByRole('button', { name: '+ Create board' }));
    expect(useUiStore.getState().dialog).toEqual({
      type: 'newBoard',
      workspaceId: 'w1',
      folderId: null,
    });
  });

  it('does not offer to create a board to people who cannot edit', () => {
    renderTree({ folders: [], boards: [], canReorder: false });
    expect(screen.getByText('No boards yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Create board' })).toBeNull();
  });

  it('starts an inline rename on double click and saves it with Enter', async () => {
    const props = renderTree();
    await userEvent.dblClick(screen.getByRole('link', { name: 'Alpha board' }));
    const input = await screen.findByRole('textbox', { name: 'Board name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed{Enter}');
    expect(props.onRenameBoard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      'Renamed',
    );
  });
});
