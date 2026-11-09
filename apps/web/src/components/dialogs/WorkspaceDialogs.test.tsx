import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewWorkspaceDialog, WorkspaceSettingsDialog } from './WorkspaceDialogs';

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspace: () => ({
    data: { name: 'Home base', icon: 'H', color: '#579bfc', description: '' },
    loading: false,
    error: null,
  }),
  writes: { createWorkspace: mocks.createWorkspace, updateWorkspace: mocks.updateWorkspace },
}));

beforeEach(() => {
  mocks.createWorkspace.mockReset().mockResolvedValue('ws1');
  mocks.updateWorkspace.mockReset().mockResolvedValue(undefined);
});

function renderNew() {
  render(
    <MemoryRouter>
      <NewWorkspaceDialog onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('workspace icon picker in the dialogs', () => {
  it('creates a workspace with the first letter by default', async () => {
    renderNew();
    await userEvent.type(screen.getByLabelText('Workspace name'), 'garden');
    await userEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(mocks.createWorkspace).toHaveBeenCalled());
    expect(mocks.createWorkspace.mock.calls[0]![1]).toMatchObject({ icon: 'G' });
  });

  it('searches the icons and submits the chosen mi:<key>', async () => {
    renderNew();
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Family');
    await userEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await userEvent.type(screen.getByLabelText('Search icons'), 'rocket');
    expect(screen.queryByRole('button', { name: 'home' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'rocket launch' }));
    expect(screen.getByRole('button', { name: 'rocket launch' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(mocks.createWorkspace).toHaveBeenCalled());
    expect(mocks.createWorkspace.mock.calls[0]![1]).toMatchObject({ icon: 'mi:rocket_launch' });
  });

  it('moves between icons with the arrow keys and shows an empty state', async () => {
    renderNew();
    await userEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    const first = screen
      .getAllByRole('button', { pressed: false })
      .find((b) => b.hasAttribute('data-grid-cell'))!;
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement).toHaveAttribute('data-grid-cell');
    await userEvent.type(screen.getByLabelText('Search icons'), 'zzzzzz');
    expect(screen.getByText('No icons found')).toBeInTheDocument();
  });

  it('going back to the Letter tab drops the chosen icon', async () => {
    renderNew();
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Zed');
    await userEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await userEvent.click(screen.getByRole('button', { name: 'home' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Letter' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(mocks.createWorkspace).toHaveBeenCalled());
    expect(mocks.createWorkspace.mock.calls[0]![1]).toMatchObject({ icon: 'Z' });
  });

  it('picks an emoji', async () => {
    renderNew();
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Fun');
    await userEvent.click(screen.getByRole('tab', { name: 'Emoji' }));
    await userEvent.type(await screen.findByLabelText('Search emoji'), 'rocket');
    await userEvent.click(await screen.findByRole('button', { name: 'rocket' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(mocks.createWorkspace).toHaveBeenCalled());
    expect(mocks.createWorkspace.mock.calls[0]![1].icon).toMatch(/^🚀/u);
  });

  it('opens workspace settings on the right tab and saves a new icon', async () => {
    render(<WorkspaceSettingsDialog workspaceId="w1" onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Letter', selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await userEvent.click(screen.getByRole('button', { name: 'diversity 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateWorkspace).toHaveBeenCalled());
    expect(mocks.updateWorkspace.mock.calls[0]![1]).toMatchObject({ icon: 'mi:diversity_3' });
  });
});
