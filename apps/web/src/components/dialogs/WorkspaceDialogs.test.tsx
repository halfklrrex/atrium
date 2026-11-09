import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGULAR_PATHS } from '../workspace-icons/icons-regular.generated';
import { findWorkspaceIcon } from '../workspace-icons/icons';
import { NewWorkspaceDialog, WorkspaceSettingsDialog } from './WorkspaceDialogs';

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  workspaceIcon: 'H',
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspace: () => ({
    data: { name: 'Home base', icon: mocks.workspaceIcon, color: '#579bfc', description: '' },
    loading: false,
    error: null,
  }),
  writes: { createWorkspace: mocks.createWorkspace, updateWorkspace: mocks.updateWorkspace },
}));

beforeEach(() => {
  mocks.createWorkspace.mockReset().mockResolvedValue('ws1');
  mocks.updateWorkspace.mockReset().mockResolvedValue(undefined);
  mocks.workspaceIcon = 'H';
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

  it('searches the icons and submits the chosen ph:<key>', async () => {
    renderNew();
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Family');
    await userEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await userEvent.type(screen.getByLabelText('Search icons'), 'rocket');
    expect(screen.queryByRole('button', { name: 'house' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'rocket launch' }));
    expect(screen.getByRole('button', { name: 'rocket launch' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(mocks.createWorkspace).toHaveBeenCalled());
    expect(mocks.createWorkspace.mock.calls[0]![1]).toMatchObject({ icon: 'ph:rocket-launch' });
  });

  it('shows the regular weight in the grid and the fill weight on the selected icon', async () => {
    renderNew();
    await userEvent.click(screen.getByRole('tab', { name: 'Icons' }));
    await userEvent.type(screen.getByLabelText('Search icons'), 'rocket');
    const button = screen.getByRole('button', { name: 'rocket launch' });
    const def = findWorkspaceIcon('ph:rocket-launch')!;
    await waitFor(() =>
      expect(button.querySelector('path')).toHaveAttribute('d', REGULAR_PATHS['rocket-launch']),
    );
    await userEvent.click(button);
    expect(button.querySelector('path')).toHaveAttribute('d', def.fill);
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
    await userEvent.click(screen.getByRole('button', { name: 'house' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'users three' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateWorkspace).toHaveBeenCalled());
    expect(mocks.updateWorkspace.mock.calls[0]![1]).toMatchObject({ icon: 'ph:users-three' });
  });

  it('marks the mapped icon as selected for a legacy mi: value and keeps it when untouched', async () => {
    mocks.workspaceIcon = 'mi:home';
    render(<WorkspaceSettingsDialog workspaceId="w1" onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Icons', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'house' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateWorkspace).toHaveBeenCalled());
    expect(mocks.updateWorkspace.mock.calls[0]![1]).toMatchObject({ icon: 'mi:home' });
  });
});
