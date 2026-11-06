import {
  DASHBOARD_LIMITS,
  canManageBoard,
  capBoardRole,
  resolveBoardRole,
  type BoardKind,
  type BoardRole,
  type BoardSharingResult,
  type EntityState,
  type SetDashboardAccessRequest,
  type WorkspaceRole,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

export interface SharingDashboard {
  workspaceId: string;
  kind: BoardKind;
  access: Record<string, BoardRole>;
  state: EntityState;
}

/**
 * The slice of a Firestore transaction the dashboard sharing callable needs, so who may do what
 * can be unit tested with an in-memory fake. Contract: reads happen before the first write, and
 * `writeSharing` sets `kind`, `access`, `accessUids` (the key set of `access`), `updatedAt` and
 * `updatedBy` together. Dashboards have no activity log.
 */
export interface DashboardSharingTx {
  getDashboard(dashboardId: string): Promise<SharingDashboard | null>;
  /** `workspaces/{id}.roles`, or null when the workspace does not exist. */
  getWorkspaceRoles(workspaceId: string): Promise<Record<string, WorkspaceRole> | null>;
  writeSharing(
    dashboardId: string,
    next: { kind: BoardKind; access: Record<string, BoardRole> },
    updatedBy: string,
  ): void;
}

export const LAST_DASHBOARD_OWNER_MESSAGE =
  'A private or shareable dashboard needs at least one owner. Make someone else an owner first.';

const refused = (message: string, reason?: string) =>
  new HttpsError('failed-precondition', message, reason ? { reason } : undefined);

const sameAccess = (a: Record<string, BoardRole>, b: Record<string, BoardRole>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

const result = (kind: BoardKind, access: Record<string, BoardRole>): BoardSharingResult => ({
  kind,
  access: { ...access },
});

/**
 * Changes a dashboard's kind and/or one person's role (`role: null` removes them). Dashboard
 * owners only. Same rules as `setBoardAccess` / `setBoardKind`: the person must be a workspace
 * member, the role is capped by the workspace role, a private or shareable dashboard keeps at
 * least one live owner, and going private or shareable lists the caller as an owner.
 */
export async function setDashboardAccessInTransaction(
  tx: DashboardSharingTx,
  actorUid: string,
  req: SetDashboardAccessRequest,
): Promise<BoardSharingResult> {
  const dashboard = await tx.getDashboard(req.dashboardId);
  if (!dashboard) throw new HttpsError('not-found', 'Dashboard not found.');
  const roles = await tx.getWorkspaceRoles(dashboard.workspaceId);
  if (!roles) throw new HttpsError('not-found', 'Dashboard not found.');
  const actorRole = resolveBoardRole(dashboard, actorUid, roles[actorUid]);
  // Same answer for "no such dashboard" and "not yours": one the caller cannot read stays hidden.
  if (!actorRole) throw new HttpsError('not-found', 'Dashboard not found.');
  if (dashboard.state !== 'active') {
    throw refused('This dashboard is deleted. Restore it before changing who can see it.');
  }
  if (!canManageBoard(actorRole)) {
    throw new HttpsError('permission-denied', 'Only dashboard owners can change who has access.');
  }

  const kind = req.kind ?? dashboard.kind;
  const next = { ...dashboard.access };
  if (kind !== dashboard.kind && kind !== 'main') next[actorUid] = 'owner';

  const person = req.person;
  if (person) {
    if (person.role === null) {
      delete next[person.uid];
    } else {
      const workspaceRole = roles[person.uid];
      if (!workspaceRole) {
        throw refused('Only members of this workspace can be added to a dashboard.');
      }
      if (capBoardRole(workspaceRole, person.role) !== person.role) {
        throw refused(
          workspaceRole === 'viewer'
            ? 'Viewers of this workspace can only view dashboards.'
            : 'Members of this workspace can edit dashboards but not own them.',
          'role_above_workspace',
        );
      }
      next[person.uid] = person.role;
    }
  }

  if (kind === dashboard.kind && sameAccess(dashboard.access, next)) {
    return result(dashboard.kind, dashboard.access); // idempotent retry
  }
  if (Object.keys(next).length > DASHBOARD_LIMITS.accessEntries) {
    throw refused(`A dashboard can list at most ${DASHBOARD_LIMITS.accessEntries} people.`);
  }
  const hasLiveOwner = Object.keys(next).some((uid) => next[uid] === 'owner' && roles[uid]);
  if (kind !== 'main' && !hasLiveOwner) {
    throw refused(LAST_DASHBOARD_OWNER_MESSAGE, 'last_owner');
  }
  tx.writeSharing(req.dashboardId, { kind, access: next }, actorUid);
  return result(kind, next);
}
