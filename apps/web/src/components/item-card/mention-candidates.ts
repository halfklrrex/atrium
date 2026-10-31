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
 * (case-insensitive; every word typed must match a word of the name or of the part of the email
 * before the "@", in any order, so "Jordan Lee" and "lee jor" both find Jordan Lee), at most 8. Pass
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
  const needles = query.toLowerCase().split(/\s+/).filter(Boolean);
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
    .filter((m) => {
      if (!m.name) return false;
      const words = `${m.name} ${m.local}`
        .toLowerCase()
        .split(/[\s._-]+/)
        .filter(Boolean);
      // Every typed word must match the start of or sit inside some word of the name or email,
      // in any order; the whole name and the whole email part also count, as before.
      const whole = `${m.name.toLowerCase()} ${m.local.toLowerCase()}`;
      return needles.every((n) => words.some((w) => w.includes(n)) || whole.includes(n));
    })
    .slice(0, limit)
    .map(({ uid, name, photoURL }) => ({ uid, name, photoURL }));
}
