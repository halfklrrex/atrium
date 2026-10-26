import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { ts } from '../test/fixtures';
import {
  UNKNOWN_PERSON_NAME,
  buildUserLookup,
  resetMembersStore,
  retainMembers,
  useMembersStore,
  useUserLookup,
  useWorkspaceMembers,
} from './members-store';
import type { MemberDoc } from './model';

vi.mock('./members-source', () => ({ subscribeToMembers: () => () => undefined }));

const member = (id: string, over: Partial<MemberDoc> = {}): MemberDoc => ({
  id,
  displayName: `Name ${id}`,
  photoURL: null,
  email: `${id}@example.com`,
  role: 'member',
  joinedAt: ts(),
  updatedAt: ts(),
  ...over,
});

afterEach(() => resetMembersStore());

describe('buildUserLookup', () => {
  it('resolves names and photos from member docs and the signed-in user as a fallback', () => {
    const lookup = buildUserLookup(
      [
        member('u2', { displayName: 'Jordan Lee', photoURL: 'https://example.com/j.png' }),
        member('u3', { displayName: '', email: 'sam@example.com' }),
      ],
      { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
    );
    expect(lookup('u2')).toEqual({
      uid: 'u2',
      name: 'Jordan Lee',
      photoURL: 'https://example.com/j.png',
      email: 'u2@example.com',
    });
    expect(lookup('u3')?.name).toBe('sam@example.com');
    expect(lookup('u1')?.name).toBe('Avery Quinn');
    expect(lookup('stranger')).toBeUndefined();
  });
});

describe('retainMembers', () => {
  it('shares one listener per workspace and closes it with the last user', () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const releaseA = retainMembers('w1', subscribe);
    const releaseB = retainMembers('w1', subscribe);
    retainMembers('w2', subscribe)();
    expect(subscribe).toHaveBeenCalledTimes(2);
    releaseA();
    releaseA(); // releasing twice must not close the other user's listener
    expect(unsubscribe).toHaveBeenCalledTimes(1); // only w2 so far
    releaseB();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('keeps the last members cached after the listener closes', () => {
    let push: (members: MemberDoc[]) => void = () => undefined;
    const release = retainMembers('w1', (_id, onData) => {
      push = onData;
      return () => undefined;
    });
    act(() => push([member('u2')]));
    release();
    expect(useMembersStore.getState().byWorkspace.w1?.members).toHaveLength(1);
  });
});

const auth = {
  user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
} as unknown as AuthContextValue;

function Probe({ uid, workspaceId }: { uid: string; workspaceId?: string }) {
  const person = useUserLookup(workspaceId)(uid);
  const { members } = useWorkspaceMembers(workspaceId);
  return (
    <p>
      {person?.name ?? UNKNOWN_PERSON_NAME} of {members.length}
    </p>
  );
}

describe('useUserLookup', () => {
  it('names members of the workspace being shown, sorted into the member list', () => {
    useMembersStore.setState({
      activeWorkspaceId: 'w1',
      byWorkspace: {
        w1: {
          members: [member('u2', { displayName: 'Jordan Lee' }), member('u3')],
          loaded: true,
          error: null,
        },
      },
    });
    render(
      <AuthContext.Provider value={auth}>
        <Probe uid="u2" />
      </AuthContext.Provider>,
    );
    expect(screen.getByText('Jordan Lee of 2')).toBeInTheDocument();
  });

  it('falls back to a neutral name for people who are not members', () => {
    useMembersStore.setState({
      activeWorkspaceId: 'w1',
      byWorkspace: { w1: { members: [], loaded: true, error: null } },
    });
    render(
      <AuthContext.Provider value={auth}>
        <Probe uid="gone" />
      </AuthContext.Provider>,
    );
    expect(screen.getByText(`${UNKNOWN_PERSON_NAME} of 0`)).toBeInTheDocument();
  });

  it('uses an explicit workspace id instead of the active one', () => {
    useMembersStore.setState({
      activeWorkspaceId: 'w1',
      byWorkspace: {
        w1: { members: [member('u2', { displayName: 'Wrong' })], loaded: true, error: null },
        w2: { members: [member('u2', { displayName: 'Right' })], loaded: true, error: null },
      },
    });
    render(
      <AuthContext.Provider value={auth}>
        <Probe uid="u2" workspaceId="w2" />
      </AuthContext.Provider>,
    );
    expect(screen.getByText('Right of 1')).toBeInTheDocument();
  });
});
