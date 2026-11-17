import {
  DASHBOARD_LIMITS,
  type BoardKind,
  type BoardRole,
  type BoardSharingResult,
  type SetDashboardAccessRequest,
  type WorkspaceRole,
} from '@atrium/shared';
import {
  lastOwnerMessage,
  setEntityAccessInTransaction,
  type SharingEntity,
} from './entity-sharing';

export type SharingDashboard = SharingEntity;

/**
 * The slice of a Firestore transaction the dashboard sharing callable needs. Contract: reads
 * happen before the first write, and `writeSharing` sets `kind`, `access`, `accessUids` (the key
 * set of `access`), `updatedAt` and `updatedBy` together. Dashboards have no activity log.
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

export const LAST_DASHBOARD_OWNER_MESSAGE = lastOwnerMessage('dashboard');

/**
 * Changes a dashboard's kind and/or one person's role (`role: null` removes them). Dashboard
 * owners only; the rules live in `entity-sharing.ts`, shared with docs.
 */
export function setDashboardAccessInTransaction(
  tx: DashboardSharingTx,
  actorUid: string,
  req: SetDashboardAccessRequest,
): Promise<BoardSharingResult> {
  return setEntityAccessInTransaction(
    { noun: 'dashboard', accessEntries: DASHBOARD_LIMITS.accessEntries },
    {
      getEntity: (id) => tx.getDashboard(id),
      getWorkspaceRoles: (id) => tx.getWorkspaceRoles(id),
      writeSharing: (id, next, by) => tx.writeSharing(id, next, by),
    },
    actorUid,
    { id: req.dashboardId, kind: req.kind, person: req.person },
  );
}
