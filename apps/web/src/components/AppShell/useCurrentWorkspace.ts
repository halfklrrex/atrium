import { useMatch } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useBoard, useWorkspaces, type WorkspaceDoc } from '../../data';
import { idFromSlugParam } from '../../lib/paths';

/**
 * The workspace the shell is showing: the one in the URL (workspace page, or the board's workspace),
 * else the last one the user opened, else their first. Always one of "my workspaces" or `null`.
 */
export function useCurrentWorkspace(): {
  workspace: WorkspaceDoc | null;
  workspaces: WorkspaceDoc[];
  loading: boolean;
  error: Error | null;
} {
  const { user, lastWorkspaceId } = useAuth();
  const { data: workspaces, loading, error } = useWorkspaces(user?.uid ?? null);
  const workspaceMatch = useMatch('/workspaces/:workspaceId');
  const boardMatch = useMatch('/boards/:boardId/*');
  const { data: board } = useBoard(idFromSlugParam(boardMatch?.params.boardId) || undefined);

  const wantedId =
    (idFromSlugParam(workspaceMatch?.params.workspaceId) || undefined) ??
    board?.workspaceId ??
    lastWorkspaceId;
  const workspace =
    workspaces.find((w) => w.id === wantedId) ??
    workspaces.find((w) => w.id === lastWorkspaceId) ??
    workspaces[0] ??
    null;
  return { workspace, workspaces, loading, error };
}
