import { useCallback } from 'react';
import { useUserLookup } from './members-store';
import { useTeamLookup } from './teams';

/**
 * `id -> display name` for a person (workspace member) or a team of the workspace. Person ids and
 * team ids never collide, so one lookup serves the table, grouping and exports: People cells hold
 * both kinds (TEAMS PR 3). Undefined for an unknown id.
 */
export function usePersonOrTeamName(workspaceId?: string): (id: string) => string | undefined {
  const member = useUserLookup(workspaceId);
  const team = useTeamLookup(workspaceId);
  return useCallback((id: string) => member(id)?.name ?? team(id)?.name, [member, team]);
}
