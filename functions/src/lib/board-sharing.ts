import {
  canManageBoard,
  capBoardRole,
  resolveBoardRole,
  type BoardKind,
  type BoardRole,
  type BoardSharingResult,
  type EntityState,
  type LeaveBoardRequest,
  type SetBoardAccessRequest,
  type SetBoardKindRequest,
  type WorkspaceRole,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { actorOf, activityDoc, type MemberProfile, type NewActivity } from './activity';

export interface SharingBoard {
  workspaceId: string;
  kind: BoardKind;
  access: Record<string, BoardRole>;
  state: EntityState;
}

/**
 * The slice of a Firestore transaction the board sharing callables need, so who may do what can be
 * unit tested with an in-memory fake. Contract: reads happen before the first write, and
 * `writeSharing` sets `kind`, `access`, `accessUids` (the key set of `access`), `updatedAt` and
 * `updatedBy` together. The activity entries (P4) are written in the same transaction, after the
 * member profiles they name were read (so the profile read comes before `writeSharing`).
 */
export interface BoardSharingTx {
  getBoard(boardId: string): Promise<SharingBoard | null>;
  /** `workspaces/{id}.roles`, or null when the workspace does not exist. */
  getWorkspaceRoles(workspaceId: string): Promise<Record<string, WorkspaceRole> | null>;
  writeSharing(
    boardId: string,
    next: { kind: BoardKind; access: Record<string, BoardRole> },
    updatedBy: string,
  ): void;
  /** Display names and photos of the workspace members that have a member document. */
  getMemberProfiles(
    workspaceId: string,
    uids: readonly string[],
  ): Promise<Map<string, MemberProfile>>;
  /** Creates the activity entries of this change (P4). */
  appendActivity(boardId: string, docs: readonly NewActivity[]): void;
}

const denied = (message: string, reason?: string) =>
  new HttpsError('permission-denied', message, reason ? { reason } : undefined);
const refused = (message: string, reason?: string) =>
  new HttpsError('failed-precondition', message, reason ? { reason } : undefined);

export const LAST_OWNER_MESSAGE =
  'A private or shareable board needs at least one owner. Make someone else an owner first.';

interface Loaded {
  board: SharingBoard;
  roles: Record<string, WorkspaceRole>;
  actorRole: BoardRole | null;
}

async function load(tx: BoardSharingTx, boardId: string, actorUid: string): Promise<Loaded> {
  const board = await tx.getBoard(boardId);
  if (!board) throw new HttpsError('not-found', 'Board not found.');
  const roles = await tx.getWorkspaceRoles(board.workspaceId);
  if (!roles) throw new HttpsError('not-found', 'Board not found.');
  const actorRole = resolveBoardRole(board, actorUid, roles[actorUid]);
  // Same answer for "no such board" and "not yours": a board the caller cannot read stays hidden.
  if (!actorRole) throw new HttpsError('not-found', 'Board not found.');
  if (board.state !== 'active') {
    throw refused('This board is archived or deleted. Restore it before changing who can see it.');
  }
  return { board, roles, actorRole };
}

function requireOwner(actorRole: BoardRole | null): void {
  if (!canManageBoard(actorRole)) throw denied('Only board owners can change who has access.');
}

/** Explicit owners who are still workspace members (a stale entry of a removed member counts for nothing). */
function liveOwners(access: Record<string, BoardRole>, roles: Record<string, WorkspaceRole>) {
  return Object.keys(access).filter((uid) => access[uid] === 'owner' && roles[uid]);
}

const sameAccess = (a: Record<string, BoardRole>, b: Record<string, BoardRole>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

const result = (kind: BoardKind, access: Record<string, BoardRole>): BoardSharingResult => ({
  kind,
  access: { ...access },
});

/** Adds a person, changes their role, or removes them (`role: null`). */
export async function setBoardAccessInTransaction(
  tx: BoardSharingTx,
  actorUid: string,
  req: SetBoardAccessRequest,
): Promise<BoardSharingResult> {
  const { board, roles, actorRole } = await load(tx, req.boardId, actorUid);
  requireOwner(actorRole);

  const next = { ...board.access };
  if (req.role === null) {
    delete next[req.uid];
  } else {
    const workspaceRole = roles[req.uid];
    if (!workspaceRole) throw refused('Only members of this workspace can be added to a board.');
    if (capBoardRole(workspaceRole, req.role) !== req.role) {
      throw refused(
        workspaceRole === 'viewer'
          ? 'Viewers of this workspace can only view boards.'
          : 'Members of this workspace can edit boards but not own them.',
        'role_above_workspace',
      );
    }
    next[req.uid] = req.role;
  }

  if (sameAccess(board.access, next)) return result(board.kind, board.access); // idempotent retry
  if (board.kind !== 'main' && liveOwners(next, roles).length === 0) {
    throw refused(LAST_OWNER_MESSAGE, 'last_owner');
  }
  const profiles = await tx.getMemberProfiles(board.workspaceId, [actorUid, req.uid]);
  tx.writeSharing(req.boardId, { kind: board.kind, access: next }, actorUid);
  tx.appendActivity(req.boardId, [
    activityDoc(actorOf(actorUid, profiles.get(actorUid)), 'board_access_changed', {
      data: {
        targetUid: req.uid,
        targetName: profiles.get(req.uid)?.name || 'Someone',
        fromRole: board.access[req.uid] ?? null,
        toRole: req.role,
      },
    }),
  ]);
  return result(board.kind, next);
}

/** Changes the board's kind; going private or shareable adds the caller as an explicit owner. */
export async function setBoardKindInTransaction(
  tx: BoardSharingTx,
  actorUid: string,
  req: SetBoardKindRequest,
): Promise<BoardSharingResult> {
  const { board, actorRole } = await load(tx, req.boardId, actorUid);
  requireOwner(actorRole);
  if (req.kind === board.kind) throw refused(`This board is already ${req.kind}.`, 'no_change');

  const access = { ...board.access };
  if (req.kind !== 'main') access[actorUid] = 'owner';
  const profiles = await tx.getMemberProfiles(board.workspaceId, [actorUid]);
  tx.writeSharing(req.boardId, { kind: req.kind, access }, actorUid);
  tx.appendActivity(req.boardId, [
    activityDoc(actorOf(actorUid, profiles.get(actorUid)), 'board_kind_changed', {
      data: { fromKind: board.kind, toKind: req.kind },
    }),
  ]);
  return result(req.kind, access);
}

/** The caller removes their own explicit access from a private or shareable board. */
export async function leaveBoardInTransaction(
  tx: BoardSharingTx,
  actorUid: string,
  req: LeaveBoardRequest,
): Promise<BoardSharingResult> {
  const { board, roles } = await load(tx, req.boardId, actorUid);
  if (board.kind === 'main') {
    throw refused('Everyone in the workspace can open a main board, so there is nothing to leave.');
  }
  if (!board.access[actorUid]) throw refused('You are not on this board.');

  const next = { ...board.access };
  delete next[actorUid];
  if (liveOwners(next, roles).length === 0) throw refused(LAST_OWNER_MESSAGE, 'last_owner');
  const profiles = await tx.getMemberProfiles(board.workspaceId, [actorUid]);
  tx.writeSharing(req.boardId, { kind: board.kind, access: next }, actorUid);
  tx.appendActivity(req.boardId, [
    activityDoc(actorOf(actorUid, profiles.get(actorUid)), 'board_left', {
      data: { fromRole: board.access[actorUid] ?? null },
    }),
  ]);
  return result(board.kind, next);
}
