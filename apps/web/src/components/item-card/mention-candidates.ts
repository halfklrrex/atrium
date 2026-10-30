import { resolveBoardRole } from '@atrium/shared';
import type { BoardDoc, MemberDoc, WorkspaceDoc } from '../../data/model';

/** A member offered in an @ list. */
export interface MentionCandidate {
  uid: string;
  name: string;
  photoURL: string | null;
}

export const MAX_MENTION_SUGGESTIONS = 8;

/**
 * The workspace members who can read the board and match what was typed after the "@"
 * (case-insensitive, in the name or the part of the email before the "@"), at most 8. Pass
 * `excludeUid` to leave someone out (the update composer leaves out its author).
 */
export function mentionCandidates({
  board,
  workspace,
  members,
  query,
  excludeUid,
  limit = MAX_MENTION_SUGGESTIONS,
}: {
  board: BoardDoc | null | undefined;
  workspace: WorkspaceDoc | null | undefined;
  members: readonly MemberDoc[];
  query: string;
  excludeUid?: string | undefined;
  limit?: number;
}): MentionCandidate[] {
  if (!board || !workspace) return [];
  const needle = query.trim().toLowerCase();
  return members
    .filter(
      (m) => m.id !== excludeUid && resolveBoardRole(board, m.id, workspace.roles[m.id]) !== null,
    )
    .map((m) => ({
      uid: m.id,
      name: m.displayName || m.email,
      photoURL: m.photoURL,
      local: (m.email ?? '').split('@')[0] ?? '',
    }))
    .filter(
      (m) =>
        m.name && (m.name.toLowerCase().includes(needle) || m.local.toLowerCase().includes(needle)),
    )
    .slice(0, limit)
    .map(({ uid, name, photoURL }) => ({ uid, name, photoURL }));
}
