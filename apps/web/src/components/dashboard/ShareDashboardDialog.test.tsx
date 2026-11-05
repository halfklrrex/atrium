import type { BoardRole, WorkspaceRole } from '@atrium/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { resetMembersStore, useMembersStore } from '../../data/members-store';
import type { MemberDoc } from '../../data/model';
import { makeDashboard, makeWorkspace, ts } from '../../test/fixtures';
import { ShareDashboardDialog } from './ShareDashboardDialog';

const mocks = vi.hoisted(() => ({
  dashboard: null as unknown,
  setSharing: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useDashboard: () => ({ data: mocks.dashboard, loading: false, error: null }),
  useWorkspace: () => ({
    data: makeWorkspace({
      id: 'w1',
      roles: { owner: 'owner', member: 'member', viewer: 'viewer' },
      memberIds: ['owner', 'member', 'viewer'],
    }),
    loading: false,
    error: null,
  }),
  dashboardWrites: { setDashboardSharing: mocks.setSharing },
}));

const member = (id: string, name: string, role: WorkspaceRole): MemberDoc => ({
  id,
  displayName: name,
  photoURL: null,
  email: `${id}@example.com`,
  role,
  joinedAt: ts(),
  updatedAt: ts(),
});

const authFor = (uid: string) =>
  ({
    status: 'ready',
    user: { uid, displayName: uid, email: `${uid}@example.com`, photoURL: null },
    lastWorkspaceId: 'w1',
    error: null,
    redirectError: null,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    retryBootstrap: vi.fn(),
    rememberWorkspace: vi.fn(),
  }) as unknown as AuthContextValue;

function renderDialog(as: string, access: Record<string, BoardRole>, kind: 'main' | 'private') {
  mocks.dashboard = makeDashboard({
    id: 'd1',
    name: 'Team overview',
    kind,
    access,
    accessUids: Object.keys(access),
  });
  render(
    <AuthContext.Provider value={authFor(as)}>
      <MemoryRouter>
        <ShareDashboardDialog dashboardId="d1" onClose={vi.fn()} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  mocks.setSharing.mockReset().mockResolvedValue(undefined);
  resetMembersStore();
  useMembersStore.setState({
    activeWorkspaceId: 'w1',
    byWorkspace: {
      w1: {
        loaded: true,
        error: null,
        members: [
          member('owner', 'Avery Quinn', 'owner'),
          member('member', 'Sam Rivera', 'member'),
          member('viewer', 'Casey Morgan', 'viewer'),
        ],
      },
    },
  });
});

describe('ShareDashboardDialog', () => {
  it('lets an owner add a workspace member with a role within their cap', async () => {
    renderDialog('owner', { owner: 'owner' }, 'private');
    await userEvent.type(screen.getByLabelText('Add people'), 'casey');
    await userEvent.click(screen.getByRole('button', { name: 'Add Casey Morgan' }));
    await waitFor(() => expect(mocks.setSharing).toHaveBeenCalled());
    expect(mocks.setSharing).toHaveBeenCalledWith('d1', {
      person: { uid: 'viewer', role: 'viewer' },
    });
  });

  it('changes the dashboard type after a confirmation', async () => {
    renderDialog('owner', { owner: 'owner' }, 'private');
    await userEvent.click(screen.getByRole('radio', { name: 'Main' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make main' }));
    await waitFor(() => expect(mocks.setSharing).toHaveBeenCalledWith('d1', { kind: 'main' }));
  });

  it('is read-only for people who are not owners', () => {
    renderDialog('member', { owner: 'owner', member: 'editor' }, 'private');
    expect(screen.queryByLabelText('Add people')).toBeNull();
    expect(screen.getByText(/Only a dashboard owner/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Main' })).toBeDisabled();
  });

  it('blocks removing the last owner', async () => {
    renderDialog('owner', { owner: 'owner' }, 'private');
    await userEvent.click(screen.getByRole('button', { name: /^Remove Avery/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one owner/);
    expect(mocks.setSharing).not.toHaveBeenCalled();
  });
});
