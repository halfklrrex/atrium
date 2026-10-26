import type { WorkspaceRole } from '@atrium/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { resetMembersStore, useMembersStore } from '../../data/members-store';
import type { InviteDoc, MemberDoc } from '../../data/model';
import { InvitePage } from '../../pages/InvitePage';
import { makeWorkspace, ts } from '../../test/fixtures';
import { MembersDialog } from './MembersDialog';
import { memberRowActions } from './permissions';
import { describeExpiry } from './roles';

const mocks = vi.hoisted(() => ({
  roles: {} as Record<string, string>,
  invites: [] as unknown[],
  calls: {
    createInvite: vi.fn(),
    revokeInvite: vi.fn(),
    listMyInvites: vi.fn(),
    getInviteStatus: vi.fn(),
    acceptInvite: vi.fn(),
    declineInvite: vi.fn(),
    changeMemberRole: vi.fn(),
    removeMember: vi.fn(),
    leaveWorkspace: vi.fn(),
  },
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));
vi.mock('../../lib/callables', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  membershipCalls: mocks.calls,
}));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspace: () => ({
    data: makeWorkspace({
      id: 'w1',
      name: 'Home base',
      roles: mocks.roles as Record<string, WorkspaceRole>,
      memberIds: Object.keys(mocks.roles),
    }),
    loading: false,
    error: null,
  }),
  useWorkspaceInvites: (_id: string | undefined, enabled: boolean) => ({
    data: enabled ? mocks.invites : [],
    loading: false,
    error: null,
  }),
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

function authFor(uid: string): AuthContextValue {
  return {
    status: 'ready',
    user: { uid, displayName: uid, email: `${uid}@example.com`, photoURL: null },
    lastWorkspaceId: 'w1',
    error: null,
    redirectError: null,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    retryBootstrap: vi.fn(),
    rememberWorkspace: vi.fn(),
  } as unknown as AuthContextValue;
}

function seedWorkspace() {
  mocks.roles = { owner: 'owner', admin: 'admin', member: 'member', viewer: 'viewer' };
  useMembersStore.setState({
    activeWorkspaceId: 'w1',
    byWorkspace: {
      w1: {
        loaded: true,
        error: null,
        members: [
          member('owner', 'Avery Quinn', 'owner'),
          member('admin', 'Jordan Lee', 'admin'),
          member('member', 'Sam Rivera', 'member'),
          member('viewer', 'Casey Morgan', 'viewer'),
        ],
      },
    },
  });
}

function renderDialog(as: string, initialTab?: 'members' | 'invites') {
  const onClose = vi.fn();
  render(
    <AuthContext.Provider value={authFor(as)}>
      <MemoryRouter>
        <MembersDialog workspaceId="w1" initialTab={initialTab} onClose={onClose} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { onClose };
}

beforeEach(() => {
  seedWorkspace();
  mocks.invites = [];
  for (const fn of Object.values(mocks.calls)) fn.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => resetMembersStore());

describe('memberRowActions', () => {
  it('follows the role matrix', () => {
    expect(memberRowActions('owner', 'member', false)).toEqual({
      roleChoices: ['member', 'admin', 'viewer'],
      canTransfer: true,
      canRemove: true,
      canLeave: false,
    });
    expect(memberRowActions('admin', 'member', false)).toMatchObject({
      roleChoices: ['member', 'viewer'],
      canTransfer: false,
      canRemove: true,
    });
    expect(memberRowActions('admin', 'admin', false)).toMatchObject({
      roleChoices: [],
      canRemove: false,
    });
    expect(memberRowActions('member', 'viewer', false)).toMatchObject({
      roleChoices: [],
      canRemove: false,
    });
    expect(memberRowActions('member', 'member', true)).toMatchObject({
      roleChoices: [],
      canLeave: true,
    });
    expect(memberRowActions('owner', 'owner', true)).toEqual({
      roleChoices: [],
      canTransfer: false,
      canRemove: false,
      canLeave: false,
    });
  });
});

describe('MembersDialog', () => {
  it('lists members with names and emails, owner first', () => {
    renderDialog('owner');
    const list = screen.getByRole('list', { name: 'Members' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Avery Quinn (you)'),
      expect.stringContaining('Jordan Lee'),
      expect.stringContaining('Sam Rivera'),
      expect.stringContaining('Casey Morgan'),
    ]);
    expect(within(rows[2]!).getByText('member@example.com')).toBeInTheDocument();
  });

  it('gives the owner role dropdowns and a menu on every other member', () => {
    renderDialog('owner');
    expect(screen.getByRole('combobox', { name: 'Role for Jordan Lee' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Sam Rivera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Sam Rivera' })).toBeInTheDocument();
    // The owner's own row is a plain label with no menu.
    expect(
      screen.queryByRole('combobox', { name: 'Role for Avery Quinn' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Avery Quinn' })).toBeNull();
    expect(screen.getByRole('tab', { name: /invites/i })).toBeInTheDocument();
  });

  it('lets an admin manage members and viewers only', () => {
    renderDialog('admin');
    expect(screen.getByRole('combobox', { name: 'Role for Sam Rivera' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Casey Morgan' })).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Role for Avery Quinn' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Avery Quinn' })).toBeNull();
    // On their own row an admin gets no role dropdown, only the leave action.
    expect(screen.queryByRole('combobox', { name: 'Role for Jordan Lee' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Jordan Lee' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /invites/i })).toBeInTheDocument();
  });

  it('shows a plain member only a leave action on their own row, and no Invites tab', () => {
    renderDialog('member');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Actions for Sam Rivera' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Casey Morgan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Avery Quinn' })).toBeNull();
  });

  it('lets a viewer leave too, but not manage anyone', () => {
    renderDialog('viewer');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Actions for Casey Morgan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for Sam Rivera' })).toBeNull();
  });

  it('confirms before removing and then calls removeMember', async () => {
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Actions for Sam Rivera' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from workspace' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Remove Sam Rivera from Home base?');
    expect(mocks.calls.removeMember).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(mocks.calls.removeMember).toHaveBeenCalledWith({ workspaceId: 'w1', uid: 'member' }),
    );
  });

  it('offers ownership transfer to the owner behind a confirmation', async () => {
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Actions for Jordan Lee' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Transfer ownership' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() =>
      expect(mocks.calls.changeMemberRole).toHaveBeenCalledWith({
        workspaceId: 'w1',
        uid: 'admin',
        role: 'owner',
      }),
    );
  });

  it('closes and leaves the workspace for a member', async () => {
    const { onClose } = renderDialog('member');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Actions for Sam Rivera' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Leave workspace' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Leave workspace',
      }),
    );
    await waitFor(() =>
      expect(mocks.calls.leaveWorkspace).toHaveBeenCalledWith({ workspaceId: 'w1' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('invites by email from the Invites tab and lists pending invites', async () => {
    mocks.calls.createInvite.mockResolvedValue({ inviteId: 'i9', inviteUrl: 'unused' });
    mocks.invites = [
      {
        id: 'i1',
        email: 'friend@example.com',
        role: 'viewer',
        invitedBy: 'owner',
        invitedByName: 'Avery Quinn',
        workspaceName: 'Home base',
        createdAt: ts(),
        expiresAt: ts(Date.now() + 3 * 24 * 60 * 60 * 1000),
        status: 'pending',
      } satisfies Omit<InviteDoc, 'id'> & { id: string },
    ];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    renderDialog('owner', 'invites');
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const pending = screen.getByRole('list', { name: 'Pending invitations' });
    expect(within(pending).getByText('friend@example.com')).toBeInTheDocument();
    expect(within(pending).getByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();

    const invite = screen.getByRole('button', { name: 'Invite' });
    expect(invite).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByLabelText('Invitee email'), '  New.Person@Example.com ');
    expect(invite).toHaveAttribute('aria-disabled', 'false');
    await user.click(invite);
    await waitFor(() =>
      expect(mocks.calls.createInvite).toHaveBeenCalledWith({
        workspaceId: 'w1',
        email: 'new.person@example.com',
        role: 'member',
      }),
    );

    await user.click(within(pending).getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(mocks.calls.revokeInvite).toHaveBeenCalledWith({ workspaceId: 'w1', inviteId: 'i1' }),
    );
  });

  it('shows the server explanation when a call is refused', async () => {
    mocks.calls.removeMember.mockRejectedValue({
      code: 'functions/permission-denied',
      message: 'You do not have permission to remove that person.',
    });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Actions for Sam Rivera' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove from workspace' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    expect(await screen.findByText(/do not have permission to remove/i)).toBeInTheDocument();
  });
});

describe('describeExpiry', () => {
  it('reads in days and flags expired invites', () => {
    const now = 1_000_000;
    const day = 24 * 60 * 60 * 1000;
    expect(describeExpiry(now + 3 * day, now)).toBe('Expires in 3 days');
    expect(describeExpiry(now + day / 2, now)).toBe('Expires in 1 day');
    expect(describeExpiry(now - 1, now)).toBe('Expired');
  });
});

describe('InvitePage', () => {
  function renderPage() {
    render(
      <AuthContext.Provider value={authFor('friend')}>
        <MemoryRouter initialEntries={['/invite/w1/i1']}>
          <Routes>
            <Route path="/invite/:workspaceId/:inviteId" element={<InvitePage />} />
            <Route path="/workspaces/:id" element={<p>Workspace page</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
  }

  const myInvite = {
    workspaceId: 'w1',
    inviteId: 'i1',
    workspaceName: 'Home base',
    role: 'member',
    invitedBy: 'owner',
    invitedByName: 'Avery Quinn',
    expiresAt: Date.now() + 1000,
  };

  it('shows who invited you and accepts into the workspace', async () => {
    mocks.calls.listMyInvites.mockResolvedValue({ invites: [myInvite] });
    mocks.calls.acceptInvite.mockResolvedValue({ workspaceId: 'w1', role: 'member' });
    renderPage();
    expect(await screen.findByText('Avery Quinn')).toBeInTheDocument();
    expect(screen.getByText(/invited you to/)).toHaveTextContent(
      'Avery Quinn invited you to Home base as member.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(mocks.calls.acceptInvite).toHaveBeenCalledWith({ workspaceId: 'w1', inviteId: 'i1' }),
    );
    expect(await screen.findByText('Workspace page')).toBeInTheDocument();
  });

  it('declines without joining', async () => {
    mocks.calls.listMyInvites.mockResolvedValue({ invites: [myInvite] });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await waitFor(() =>
      expect(mocks.calls.declineInvite).toHaveBeenCalledWith({ workspaceId: 'w1', inviteId: 'i1' }),
    );
    expect(await screen.findByText('You declined this invitation')).toBeInTheDocument();
  });

  it.each([
    [{ state: 'wrong_email' }, /sent to another email address\. Sign in with that Google account/i],
    [{ state: 'expired', invitedByName: 'Avery Quinn' }, /expired/i],
    [{ state: 'revoked', invitedByName: 'Avery Quinn' }, /withdrawn/i],
    [{ state: 'not_found' }, /couldn't find that invitation/i],
  ])('explains an unusable link (%j)', async (status, text) => {
    mocks.calls.listMyInvites.mockResolvedValue({ invites: [] });
    mocks.calls.getInviteStatus.mockResolvedValue(status);
    renderPage();
    expect(await screen.findByRole('heading')).toBeInTheDocument();
    expect(await screen.findByText(text, { selector: 'p, h1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('offers sign-out for a wrong-email invite', async () => {
    mocks.calls.listMyInvites.mockResolvedValue({ invites: [] });
    mocks.calls.getInviteStatus.mockResolvedValue({ state: 'wrong_email' });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
