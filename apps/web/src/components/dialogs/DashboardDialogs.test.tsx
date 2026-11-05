import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDashboard } from '../../test/fixtures';
import { NewDashboardDialog } from './DashboardDialogs';

const mocks = vi.hoisted(() => ({ createDashboard: vi.fn(), dashboards: [] as unknown[] }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspaceDashboards: () => ({ data: mocks.dashboards, loading: false, error: null }),
  dashboardWrites: { createDashboard: mocks.createDashboard },
}));

function renderDialog(folderId: string | null = null) {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={<NewDashboardDialog workspaceId="w1" folderId={folderId} onClose={onClose} />}
        />
        <Route path="/dashboards/:id" element={<p>dashboard page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return onClose;
}

beforeEach(() => {
  mocks.createDashboard.mockReset().mockResolvedValue('new-dash');
  mocks.dashboards = [];
});

describe('NewDashboardDialog', () => {
  it('needs a name', async () => {
    renderDialog();
    const create = screen.getByRole('button', { name: 'Create dashboard' });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText('Dashboard name'), '   ');
    expect(create).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText('Dashboard name'), 'Team overview');
    expect(create).toHaveAttribute('aria-disabled', 'false');
  });

  it('offers the same types as boards, Main by default', () => {
    renderDialog();
    expect(screen.getByRole('radio', { name: 'Main' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Private' })).not.toBeChecked();
  });

  it('creates the dashboard after its siblings and opens it', async () => {
    mocks.dashboards = [makeDashboard({ id: 'd0', folderId: 'f1', position: 'a0' })];
    const onClose = renderDialog('f1');
    await userEvent.type(screen.getByLabelText('Dashboard name'), 'Budget');
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));
    await waitFor(() => expect(mocks.createDashboard).toHaveBeenCalled());
    const [uid, workspaceId, input, position] = mocks.createDashboard.mock.calls[0]!;
    expect([uid, workspaceId]).toEqual(['u1', 'w1']);
    expect(input).toMatchObject({ name: 'Budget', kind: 'private', folderId: 'f1' });
    expect(position > 'a0').toBe(true);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
  });

  it('shows an error and stays open when the write fails', async () => {
    mocks.createDashboard.mockRejectedValue({ code: 'permission-denied' });
    const onClose = renderDialog();
    await userEvent.type(screen.getByLabelText('Dashboard name'), 'Budget');
    await userEvent.click(screen.getByRole('button', { name: 'Create dashboard' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission");
    expect(onClose).not.toHaveBeenCalled();
  });
});
