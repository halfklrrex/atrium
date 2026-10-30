import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useAuth } from '../auth/auth-context';
import { subscribeToMembers } from './members-source';
import type { MemberDoc } from './model';

/** Name shown for a person whose profile is unknown (for example someone who has left). */
export const UNKNOWN_PERSON_NAME = 'Board member';

/** Name shown for an uploader or session owner whose profile can't be resolved. */
export const UNKNOWN_MEMBER_NAME = 'Unknown member';

/** What the UI needs to draw a person. */
export interface PersonInfo {
  uid: string;
  name: string;
  photoURL: string | null;
  email: string | null;
}

interface MembersEntry {
  members: MemberDoc[];
  loaded: boolean;
  error: Error | null;
}

interface MembersState {
  byWorkspace: Record<string, MembersEntry>;
  /** The workspace the shell is showing; avatars and people cells resolve names against it. */
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
}

export const useMembersStore = create<MembersState>()((set) => ({
  byWorkspace: {},
  activeWorkspaceId: null,
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
}));

const NO_MEMBERS: MemberDoc[] = [];

/** Open listeners, one per workspace, shared by every component that asks for its members. */
const listeners = new Map<string, { count: number; unsubscribe: () => void }>();

type Subscribe = typeof subscribeToMembers;

function putEntry(workspaceId: string, entry: MembersEntry) {
  useMembersStore.setState((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: entry } }));
}

/**
 * Keeps one live listener on `workspaces/{id}/members` for as long as somebody uses it. The data stays
 * cached in the store after the last user leaves, so avatars do not flash when a page changes.
 */
export function retainMembers(
  workspaceId: string,
  subscribe: Subscribe = subscribeToMembers,
): () => void {
  let listener = listeners.get(workspaceId);
  if (!listener) {
    const unsubscribe = subscribe(
      workspaceId,
      (members) => putEntry(workspaceId, { members, loaded: true, error: null }),
      (error) =>
        putEntry(workspaceId, {
          members: useMembersStore.getState().byWorkspace[workspaceId]?.members ?? NO_MEMBERS,
          loaded: true,
          error,
        }),
    );
    listener = { count: 0, unsubscribe };
    listeners.set(workspaceId, listener);
  }
  listener.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = listeners.get(workspaceId);
    if (!current) return;
    current.count -= 1;
    if (current.count <= 0) {
      current.unsubscribe();
      listeners.delete(workspaceId);
    }
  };
}

/** Test helper: forget every listener and cached member list. */
export function resetMembersStore(): void {
  for (const l of listeners.values()) l.unsubscribe();
  listeners.clear();
  useMembersStore.setState({ byWorkspace: {}, activeWorkspaceId: null });
}

const byName = (a: MemberDoc, b: MemberDoc) =>
  (a.displayName || a.email).localeCompare(b.displayName || b.email, undefined, {
    sensitivity: 'base',
  });

/**
 * Members of a workspace (default: the one the shell is showing), live and sorted by name.
 * One listener per open workspace, however many components ask.
 */
export function useWorkspaceMembers(workspaceId?: string): {
  workspaceId: string | null;
  members: MemberDoc[];
  loading: boolean;
} {
  const active = useMembersStore((s) => s.activeWorkspaceId);
  const id = workspaceId ?? active;
  useEffect(() => (id ? retainMembers(id) : undefined), [id]);
  const entry = useMembersStore((s) => (id ? s.byWorkspace[id] : undefined));
  const sorted = useMemo(() => (entry ? [...entry.members].sort(byName) : NO_MEMBERS), [entry]);
  return { workspaceId: id, members: sorted, loading: id ? !entry?.loaded : false };
}

interface SelfProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

/** Pure lookup builder: member docs first, the signed-in user's own auth profile as a fallback. */
export function buildUserLookup(
  members: readonly MemberDoc[],
  self: SelfProfile | null,
): (uid: string) => PersonInfo | undefined {
  const byUid = new Map(members.map((m) => [m.id, m]));
  return (uid) => {
    const member = byUid.get(uid);
    if (member) {
      const name = member.displayName || member.email;
      if (name) {
        return { uid, name, photoURL: member.photoURL ?? null, email: member.email || null };
      }
    }
    if (self && self.uid === uid) {
      const name = self.displayName ?? self.email;
      if (name) return { uid, name, photoURL: self.photoURL, email: self.email };
    }
    return undefined;
  };
}

/**
 * `(uid) => {name, photoURL} | undefined` for the given workspace (default: the one the shell is
 * showing). Unknown people (left the workspace, or profiles not written yet) give `undefined`.
 */
export function useUserLookup(workspaceId?: string): (uid: string) => PersonInfo | undefined {
  const { user } = useAuth();
  const { members } = useWorkspaceMembers(workspaceId);
  const uid = user?.uid;
  const displayName = user?.displayName ?? null;
  const email = user?.email ?? null;
  const photoURL = user?.photoURL ?? null;
  return useMemo(
    () => buildUserLookup(members, uid ? { uid, displayName, email, photoURL } : null),
    [members, uid, displayName, email, photoURL],
  );
}
