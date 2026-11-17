import {
  canManageBoard,
  capBoardRole,
  resolveBoardRole,
  type BoardKind,
  type BoardRole,
  type BoardSharingResult,
  type EntityState,
  type WorkspaceRole,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

/** The fields of a shareable top-level object (dashboard, doc) that the sharing rules read. */
export interface SharingEntity {
  workspaceId: string;
  kind: BoardKind;
  access: Record<string, BoardRole>;
  state: EntityState;
}

/**
 * The slice of a Firestore transaction the sharing callables need, so who may do what can be unit
 * tested with an in-memory fake. Contract: reads happen before the first write, and
 * `writeSharing` sets `kind`, `access`, `accessUids` (the key set of `access`), `updatedAt` and
 * `updatedBy` together.
 */
export interface EntitySharingTx {
  getEntity(id: string): Promise<SharingEntity | null>;
  /** `workspaces/{id}.roles`, or null when the workspace does not exist. */
  getWorkspaceRoles(workspaceId: string): Promise<Record<string, WorkspaceRole> | null>;
  writeSharing(
    id: string,
    next: { kind: BoardKind; access: Record<string, BoardRole> },
    updatedBy: string,
  ): void;
}

/** What differs between the entities: the word used in messages and the access-map cap. */
export interface EntitySharingConfig {
  /** Lowercase singular noun used in error messages ("dashboard", "doc"). */
  noun: string;
  /** Most entries in `access`. */
  accessEntries: number;
}

/** One sharing change: a new `kind`, and/or one person's role (`role: null` removes them). */
export interface EntitySharingRequest {
  id: string;
  kind?: BoardKind;
  person?: { uid: string; role: BoardRole | null };
}

export const lastOwnerMessage = (noun: string) =>
  `A private or shareable ${noun} needs at least one owner. Make someone else an owner first.`;

const refused = (message: string, reason?: string) =>
  new HttpsError('failed-precondition', message, reason ? { reason } : undefined);

const sameAccess = (a: Record<string, BoardRole>, b: Record<string, BoardRole>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

const result = (kind: BoardKind, access: Record<string, BoardRole>): BoardSharingResult => ({
  kind,
  access: { ...access },
});

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Changes an entity's kind and/or one person's role (`role: null` removes them). Entity owners
 * only. Same rules as `setBoardAccess` / `setBoardKind`: the person must be a workspace member,
 * the role is capped by the workspace role, a private or shareable entity keeps at least one live
 * owner, and going private or shareable lists the caller as an owner.
 */
export async function setEntityAccessInTransaction(
  config: EntitySharingConfig,
  tx: EntitySharingTx,
  actorUid: string,
  req: EntitySharingRequest,
): Promise<BoardSharingResult> {
  const { noun } = config;
  const notFound = () => new HttpsError('not-found', `${capitalize(noun)} not found.`);
  const entity = await tx.getEntity(req.id);
  if (!entity) throw notFound();
  const roles = await tx.getWorkspaceRoles(entity.workspaceId);
  if (!roles) throw notFound();
  const actorRole = resolveBoardRole(entity, actorUid, roles[actorUid]);
  // Same answer for "no such entity" and "not yours": one the caller cannot read stays hidden.
  if (!actorRole) throw notFound();
  if (entity.state !== 'active') {
    throw refused(`This ${noun} is deleted. Restore it before changing who can see it.`);
  }
  if (!canManageBoard(actorRole)) {
    throw new HttpsError('permission-denied', `Only ${noun} owners can change who has access.`);
  }

  const kind = req.kind ?? entity.kind;
  const next = { ...entity.access };
  if (kind !== entity.kind && kind !== 'main') next[actorUid] = 'owner';

  const person = req.person;
  if (person) {
    if (person.role === null) {
      delete next[person.uid];
    } else {
      const workspaceRole = roles[person.uid];
      if (!workspaceRole) {
        throw refused(`Only members of this workspace can be added to a ${noun}.`);
      }
      if (capBoardRole(workspaceRole, person.role) !== person.role) {
        throw refused(
          workspaceRole === 'viewer'
            ? `Viewers of this workspace can only view ${noun}s.`
            : `Members of this workspace can edit ${noun}s but not own them.`,
          'role_above_workspace',
        );
      }
      next[person.uid] = person.role;
    }
  }

  if (kind === entity.kind && sameAccess(entity.access, next)) {
    return result(entity.kind, entity.access); // idempotent retry
  }
  if (Object.keys(next).length > config.accessEntries) {
    throw refused(`A ${noun} can list at most ${config.accessEntries} people.`);
  }
  const hasLiveOwner = Object.keys(next).some((uid) => next[uid] === 'owner' && roles[uid]);
  if (kind !== 'main' && !hasLiveOwner) {
    throw refused(lastOwnerMessage(noun), 'last_owner');
  }
  tx.writeSharing(req.id, { kind, access: next }, actorUid);
  return result(kind, next);
}
