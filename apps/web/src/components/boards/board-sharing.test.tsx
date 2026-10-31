import type { BoardRole, WorkspaceRole } from '@atrium/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { resetMembersStore, useMembersStore } from '../../data/members-store';
import type { BoardDoc, MemberDoc } from '../../data/model';
import { makeBoard, makeWorkspace, ts } from '../../test/fixtures';
import { useUiStore } from '../AppShell/ui-store';
import { ShareBoardDialog } from './ShareBoardDialog';
import {
  allowedBoardRoles,
  canLeaveBoard,
  capExplanation,
  defaultAddRole,
  isLastExplicitOwner,
  membersLosingAccess,
  sharedCount,
} from './board-sharing';

const mocks = vi.hoisted(() => ({
  board: null as unknown,
  roles: {} as Record<string, string>,
  calls: { setAccess: vi.fn(), setKind: vi.fn(), leave: vi.fn() },
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));
vi.mock('../../lib/callables', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  boardSharingCalls: mocks.calls,
}));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useBoard: () => ({ data: mocks.board, loading: false, error: null }),
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

function setBoard(kind: BoardDoc['kind'], access: Record<string, BoardRole>) {
  mocks.board = makeBoard({
    id: 'b1',
    name: 'Roadmap',
    kind,
    access,
    accessUids: Object.keys(access),
  });
}

function renderDialog(as: string) {
  const onClose = vi.fn();
  render(
    <AuthContext.Provider value={authFor(as)}>
      <MemoryRouter>
        <ShareBoardDialog boardId="b1" onClose={onClose} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return { onClose };
}

beforeEach(() => {
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
  for (const fn of Object.values(mocks.calls)) {
    fn.mockReset().mockResolvedValue({ kind: 'private', access: {} });
  }
  useUiStore.setState({ dialog: null });
});

afterEach(() => resetMembersStore());

describe('sharing helpers', () => {
  const ws = { memberIds: ['owner', 'admin', 'member', 'viewer'] };

  it('counts everyone for a main board and the listed people otherwise', () => {
    expect(sharedCount({ kind: 'main', accessUids: ['owner'] }, ws)).toBe(4);
    expect(sharedCount({ kind: 'private', accessUids: ['owner', 'member'] }, ws)).toBe(2);
    expect(sharedCount({ kind: 'shareable', accessUids: ['owner'] }, ws)).toBe(1);
    expect(sharedCount({ kind: 'main', accessUids: ['owner'] }, null)).toBe(1);
  });

  it('caps the roles by the workspace role', () => {
    expect(allowedBoardRoles('owner')).toEqual(['owner', 'editor', 'viewer']);
    expect(allowedBoardRoles('admin')).toEqual(['owner', 'editor', 'viewer']);
    expect(allowedBoardRoles('member')).toEqual(['editor', 'viewer']);
    expect(allowedBoardRoles('viewer')).toEqual(['viewer']);
    expect(allowedBoardRoles(undefined)).toEqual([]);
    expect(defaultAddRole('member')).toBe('editor');
    expect(defaultAddRole('viewer')).toBe('viewer');
    expect(capExplanation('owner')).toBeNull();
    expect(capExplanation('viewer')).toMatch(/viewers/i);
  });

  it('counts members who lose access, never the caller', () => {
    const board = { kind: 'main' as const, access: { owner: 'owner' as const } };
    expect(membersLosingAccess(board, ws, 'owner')).toBe(3);
    expect(
      membersLosingAccess({ ...board, access: { owner: 'owner', member: 'editor' } }, ws, 'owner'),
    ).toBe(2);
    expect(membersLosingAccess({ ...board, kind: 'private' as never }, ws, 'owner')).toBe(0);
  });

  it('knows the last explicit owner and who may leave', () => {
    const board = { kind: 'private' as const, access: { a: 'owner', b: 'editor' } as const };
    expect(isLastExplicitOwner(board, 'a')).toBe(true);
    expect(isLastExplicitOwner(board, 'b')).toBe(false);
    expect(isLastExplicitOwner({ kind: 'private', access: { a: 'owner', c: 'owner' } }, 'a')).toBe(
      false,
    );
    expect(isLastExplicitOwner({ kind: 'main', access: { a: 'owner' } }, 'a')).toBe(false);
    expect(canLeaveBoard(board, 'b')).toBe(true);
    expect(canLeaveBoard(board, 'x')).toBe(false);
    expect(canLeaveBoard({ kind: 'main', access: { a: 'owner' } }, 'a')).toBe(false);
  });
});

describe('ShareBoardDialog', () => {
  it('lists the people on a private board with their roles', () => {
    setBoard('private', { owner: 'owner', member: 'editor' });
    renderDialog('owner');
    const list = screen.getByRole('list', { name: 'People with access' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Avery Quinn (you)');
    expect(rows[1]).toHaveTextContent('Sam Rivera');
    expect(rows[1]).toHaveTextContent('member@example.com');
    expect(screen.getByRole('combobox', { name: 'Board role for Sam Rivera' })).toBeInTheDocument();
  });

  it('adds a workspace member as an editor, capped by their workspace role', async () => {
    setBoard('private', { owner: 'owner' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.type(screen.getByLabelText('Add people'), 'casey');
    await user.click(await screen.findByRole('button', { name: 'Add Casey Morgan' }));
    await waitFor(() =>
      expect(mocks.calls.setAccess).toHaveBeenCalledWith({
        boardId: 'b1',
        uid: 'viewer',
        role: 'viewer',
      }),
    );

    await user.clear(screen.getByLabelText('Add people'));
    await user.type(screen.getByLabelText('Add people'), 'admin@example');
    await user.click(await screen.findByRole('button', { name: 'Add Jordan Lee' }));
    await waitFor(() =>
      expect(mocks.calls.setAccess).toHaveBeenLastCalledWith({
        boardId: 'b1',
        uid: 'admin',
        role: 'editor',
      }),
    );
  });

  it('says so when nobody in the workspace matches', async () => {
    setBoard('private', { owner: 'owner' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.type(screen.getByLabelText('Add people'), 'zzz');
    expect(await screen.findByText(/No workspace members match/)).toBeInTheDocument();
  });

  it('removes a person', async () => {
    setBoard('private', { owner: 'owner', member: 'editor' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Remove Sam Rivera' }));
    await waitFor(() =>
      expect(mocks.calls.setAccess).toHaveBeenCalledWith({
        boardId: 'b1',
        uid: 'member',
        role: null,
      }),
    );
  });

  it('changes a role from the dropdown', async () => {
    setBoard('private', { owner: 'owner', member: 'editor' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('combobox', { name: 'Board role for Sam Rivera' }));
    // A workspace member cannot be an owner, so only Editor and Viewer are offered.
    expect(screen.queryByRole('option', { name: 'Owner' })).toBeNull();
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await waitFor(() =>
      expect(mocks.calls.setAccess).toHaveBeenCalledWith({
        boardId: 'b1',
        uid: 'member',
        role: 'viewer',
      }),
    );
  });

  it('refuses to remove the last owner with a clear message', async () => {
    setBoard('private', { owner: 'owner', member: 'editor' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Remove Avery Quinn' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one owner/);
    expect(mocks.calls.setAccess).not.toHaveBeenCalled();
  });

  it('shows a callable refusal as the error', async () => {
    setBoard('private', { owner: 'owner', member: 'editor' });
    mocks.calls.setAccess.mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'That board is archived.',
    });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Remove Sam Rivera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That board is archived.');
  });

  it('is a read-only list for someone who is not an owner', () => {
    setBoard('private', { owner: 'owner', member: 'editor' });
    renderDialog('member');
    expect(screen.queryByLabelText('Add people')).toBeNull();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByText(/Only a board owner can change/)).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('asks before taking a main board private and names how many lose access', async () => {
    setBoard('main', { owner: 'owner' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('radio', { name: /Private/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Change board type' });
    expect(confirm).toHaveTextContent('3 workspace members will lose access');
    expect(mocks.calls.setKind).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Make private' }));
    await waitFor(() =>
      expect(mocks.calls.setKind).toHaveBeenCalledWith({ boardId: 'b1', kind: 'private' }),
    );
  });

  it('explains explicit roles when a private board goes back to main', async () => {
    setBoard('private', { owner: 'owner', member: 'viewer' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('radio', { name: /Main/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Change board type' });
    expect(confirm).toHaveTextContent(/Viewer entry still restricts/);
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.calls.setKind).not.toHaveBeenCalled();
  });

  it('collapses the implicit workspace members of a main board', async () => {
    setBoard('main', { owner: 'owner' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    expect(screen.queryByRole('list', { name: 'Workspace members' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '3 workspace members' }));
    expect(
      within(screen.getByRole('list', { name: 'Workspace members' })).getAllByRole('listitem'),
    ).toHaveLength(3);
  });

  it('links workspace admins to the Members dialog and hides it from owners of the board only', async () => {
    setBoard('private', { owner: 'owner', member: 'editor' });
    renderDialog('owner');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: 'Invite someone new to the workspace' }));
    expect(useUiStore.getState().dialog).toEqual({ type: 'members', workspaceId: 'w1' });
  });

  it('does not offer the workspace invite link to a plain board owner', () => {
    setBoard('private', { member: 'owner' });
    renderDialog('member');
    expect(
      screen.queryByRole('button', { name: 'Invite someone new to the workspace' }),
    ).toBeNull();
  });
});
