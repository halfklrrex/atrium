import type { WorkspaceRole } from '@atrium/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { resetMembersStore, useMembersStore } from '../../data/members-store';
import { resetTeamsStore, useTeamsStore } from '../../data/teams';
import type { InviteDoc, MemberDoc } from '../../data/model';
import { InvitePage } from '../../pages/InvitePage';
import { makeWorkspace, ts } from '../../test/fixtures';
import { chooseMenuItem } from '../../test/menu';
import { MembersDialog } from './MembersDialog';
import { memberRowActions } from './permissions';
import { describeExpiry } from './roles';

const mocks = vi.hoisted(() => ({
  teamCreate: vi.fn(),
  teamUpdate: vi.fn(),
  teamRemove: vi.fn(),
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
vi.mock('../../data/teams-source', () => ({ subscribeToTeams: () => () => undefined }));
vi.mock('../../data/teams-firestore', () => ({
  teamWritesImpl: { create: mocks.teamCreate, update: mocks.teamUpdate, remove: mocks.teamRemove },
}));
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

const team = (id: string, name: string, memberUids: string[]) => ({
  id,
  name,
  color: '#579bfc',
  memberUids,
  createdAt: ts(),
  createdBy: 'owner',
  updatedAt: ts(),
  updatedBy: 'owner',
});

function seedTeams(teams: ReturnType<typeof team>[]) {
  useTeamsStore.setState({ byWorkspace: { w1: { teams, loaded: true, error: null } } });
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

afterEach(() => {
  resetMembersStore();
  resetTeamsStore();
});

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

// Vibe's menu and the confirm panel render through async popper/portal steps, so on a slow
// CI runner the default 1000ms `findBy*` window can expire. Give those waits a real budget.
const SLOW_UI = { timeout: 5000 };

async function pickMenuAction(
  user: ReturnType<typeof userEvent.setup>,
  who: string,
  item: string,
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: `Actions for ${who}` }));
  await chooseMenuItem(user, item, SLOW_UI);
  return screen.findByRole('alertdialog', {}, SLOW_UI);
}

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
    expect(screen.queryByRole('tab', { name: /invites/i })).not.toBeInTheDocument();
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
    const confirm = await pickMenuAction(user, 'Sam Rivera', 'Remove from workspace');
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
    const confirm = await pickMenuAction(user, 'Jordan Lee', 'Transfer ownership');
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
    const confirm = await pickMenuAction(user, 'Sam Rivera', 'Leave workspace');
    await user.click(within(confirm).getByRole('button', { name: 'Leave workspace' }));
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
    const confirm = await pickMenuAction(user, 'Sam Rivera', 'Remove from workspace');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    // Wait for the call first, then for the alert it leads to, so a slow render fails on the
    // step that is actually slow.
    await waitFor(() => expect(mocks.calls.removeMember).toHaveBeenCalledTimes(1), SLOW_UI);
    const alert = await screen.findByRole('alert', {}, SLOW_UI);
    await waitFor(
      () => expect(alert).toHaveTextContent(/do not have permission to remove/i),
      SLOW_UI,
    );
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

describe('MembersDialog Teams tab', () => {
  beforeEach(() => {
    seedTeams([team('t1', 'Kids', ['member', 'viewer']), team('t2', 'Parents', ['owner'])]);
    for (const fn of [mocks.teamCreate, mocks.teamUpdate, mocks.teamRemove]) {
      fn.mockReset().mockResolvedValue('t3');
    }
  });

  it('lists teams read-only for a plain member', async () => {
    const user = userEvent.setup();
    renderDialog('member');
    await user.click(screen.getByRole('tab', { name: /teams/i }));
    const list = screen.getByRole('list', { name: 'Teams' });
    expect(within(list).getByText('Kids')).toBeInTheDocument();
    expect(within(list).getByText('2 members')).toBeInTheDocument();
    expect(within(list).getByText('1 member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Kids' })).toBeNull();
  });

  it('creates a team from the dialog with the chosen members', async () => {
    const user = userEvent.setup();
    renderDialog('admin');
    await user.click(screen.getByRole('tab', { name: /teams/i }));
    await user.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = await screen.findByRole('dialog', {}, SLOW_UI);
    expect(within(dialog).getByRole('button', { name: 'Create team' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.type(within(dialog).getByLabelText('Team name'), 'Garden crew');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Sam Rivera' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create team' }));
    await waitFor(() =>
      expect(mocks.teamCreate).toHaveBeenCalledWith('w1', {
        name: 'Garden crew',
        color: '#579bfc',
        memberUids: ['member'],
      }),
    );
  });

  it('filters the member checklist by search', async () => {
    const user = userEvent.setup();
    renderDialog('admin');
    await user.click(screen.getByRole('tab', { name: /teams/i }));
    await user.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = await screen.findByRole('dialog', {}, SLOW_UI);
    await user.type(within(dialog).getByLabelText('Search people'), 'jordan');
    await waitFor(() =>
      expect(within(dialog).queryByRole('checkbox', { name: 'Sam Rivera' })).toBeNull(),
    );
    expect(within(dialog).getByRole('checkbox', { name: 'Jordan Lee' })).toBeInTheDocument();
  });

  it('edits a team and drops people who already left the workspace', async () => {
    seedTeams([team('t1', 'Kids', ['member', 'gone'])]);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderDialog('owner');
    await user.click(screen.getByRole('tab', { name: /teams/i }));
    await user.click(screen.getByRole('button', { name: 'Actions for Kids' }));
    await chooseMenuItem(user, 'Edit', SLOW_UI);
    const dialog = await screen.findByRole('dialog', { name: 'Edit team' }, SLOW_UI);
    expect(
      within(dialog).getByText(
        'Someone in this team left the workspace. Remove them and save again.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.teamUpdate).toHaveBeenCalledWith('w1', 't1', {
        name: 'Kids',
        color: '#579bfc',
        memberUids: ['member'],
      }),
    );
  });

  it('asks before deleting a team, then deletes it', async () => {
    const user = userEvent.setup();
    renderDialog('owner');
    await user.click(screen.getByRole('tab', { name: /teams/i }));
    const panel = await pickMenuAction(user, 'Kids', 'Delete');
    expect(panel).toHaveTextContent(
      'Items assigned to Kids keep the entry but show "Deleted team"',
    );
    await user.click(within(panel).getByRole('button', { name: 'Delete team' }));
    await waitFor(() => expect(mocks.teamRemove).toHaveBeenCalledWith('w1', 't1'));
  });

  it('disables New team at the 50-team cap', async () => {
    seedTeams(Array.from({ length: 50 }, (_, i) => team(`t${i}`, `Team ${i}`, [])));
    const user = userEvent.setup();
    renderDialog('admin');
    await user.click(screen.getByRole('tab', { name: /teams/i }));
    expect(screen.getByRole('button', { name: 'New team' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
