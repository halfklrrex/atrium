import type { TeamInput } from '@atrium/shared';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useMembersStore } from './members-store';
import type { TeamDoc } from './model';
import { subscribeToTeams } from './teams-source';

/** Shown for a People entry whose team was deleted. */
export const DELETED_TEAM_NAME = 'Deleted team';

interface TeamsEntry {
  teams: TeamDoc[];
  loaded: boolean;
  error: Error | null;
}

interface TeamsState {
  byWorkspace: Record<string, TeamsEntry>;
}

export const useTeamsStore = create<TeamsState>()(() => ({ byWorkspace: {} }));

const NO_TEAMS: TeamDoc[] = [];

/** Open listeners, one per workspace, shared by every component that asks for its teams. */
const listeners = new Map<string, { count: number; unsubscribe: () => void }>();

type Subscribe = typeof subscribeToTeams;

function putEntry(workspaceId: string, entry: TeamsEntry) {
  useTeamsStore.setState((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: entry } }));
}

/**
 * Keeps one live listener on `workspaces/{id}/teams` for as long as somebody uses it. The data stays
 * cached in the store after the last user leaves, so names do not flash when a page changes.
 */
export function retainTeams(
  workspaceId: string,
  subscribe: Subscribe = subscribeToTeams,
): () => void {
  let listener = listeners.get(workspaceId);
  if (!listener) {
    const unsubscribe = subscribe(
      workspaceId,
      (teams) => putEntry(workspaceId, { teams, loaded: true, error: null }),
      (error) =>
        putEntry(workspaceId, {
          teams: useTeamsStore.getState().byWorkspace[workspaceId]?.teams ?? NO_TEAMS,
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

/** Test helper: closes every listener and empties the cache. */
export function resetTeamsStore(): void {
  for (const l of listeners.values()) l.unsubscribe();
  listeners.clear();
  useTeamsStore.setState({ byWorkspace: {} });
}

const byName = (a: TeamDoc, b: TeamDoc) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The workspace's teams sorted by name; falls back to the workspace the shell is showing. */
export function useWorkspaceTeams(workspaceId?: string): {
  workspaceId: string | null;
  teams: TeamDoc[];
  loading: boolean;
} {
  const active = useMembersStore((s) => s.activeWorkspaceId);
  const id = workspaceId ?? active;
  useEffect(() => (id ? retainTeams(id) : undefined), [id]);
  const entry = useTeamsStore((s) => (id ? s.byWorkspace[id] : undefined));
  const sorted = useMemo(() => (entry ? [...entry.teams].sort(byName) : NO_TEAMS), [entry]);
  return { workspaceId: id, teams: sorted, loading: id ? !entry?.loaded : false };
}

export interface TeamInfo {
  id: string;
  name: string;
  color: string;
  memberUids: readonly string[];
}

/** Pure lookup builder: team id to its name, color and members, or `undefined` for a deleted team. */
export function buildTeamLookup(teams: readonly TeamDoc[]): (id: string) => TeamInfo | undefined {
  const byId = new Map(teams.map((t) => [t.id, t]));
  return (id) => {
    const t = byId.get(id);
    return t ? { id: t.id, name: t.name, color: t.color, memberUids: t.memberUids } : undefined;
  };
}

/** `id -> { name, color, memberUids }` for the workspace's teams. */
export function useTeamLookup(workspaceId?: string): (id: string) => TeamInfo | undefined {
  const { teams } = useWorkspaceTeams(workspaceId);
  return useMemo(() => buildTeamLookup(teams), [teams]);
}

/** Team writes. The Firestore module loads on first use. Owners and admins only (rules). */
export const teamWrites = {
  async create(workspaceId: string, input: TeamInput): Promise<string> {
    return (await import('./teams-firestore')).teamWritesImpl.create(workspaceId, input);
  },
  async update(workspaceId: string, teamId: string, input: TeamInput): Promise<void> {
    return (await import('./teams-firestore')).teamWritesImpl.update(workspaceId, teamId, input);
  },
  async remove(workspaceId: string, teamId: string): Promise<void> {
    return (await import('./teams-firestore')).teamWritesImpl.remove(workspaceId, teamId);
  },
};
