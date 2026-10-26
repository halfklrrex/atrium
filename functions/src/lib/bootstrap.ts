import {
  personalWorkspaceName,
  type BootstrapUserRequest,
  type BootstrapUserResult,
  type ServerTimestampSentinel,
  type UserWrite,
  type WorkspaceWrite,
} from '@atrium/shared';

/** Verified identity taken from the Auth token (never from client-supplied data). */
export interface Identity {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

/**
 * The slice of a Firestore transaction `bootstrapUser` needs. Keeping it narrow lets the logic be unit
 * tested with an in-memory fake; `adminBootstrapTx` adapts the real Admin SDK transaction.
 * Contract: every read happens before the first write.
 */
export interface BootstrapTx {
  getUser(uid: string): Promise<{ lastWorkspaceId: string | null } | null>;
  workspaceHasMember(workspaceId: string, uid: string): Promise<boolean>;
  findMemberWorkspaceId(uid: string): Promise<string | null>;
  newWorkspaceId(): string;
  createUser(uid: string, data: UserWrite): void;
  setLastWorkspace(uid: string, workspaceId: string): void;
  createWorkspace(workspaceId: string, data: WorkspaceWrite): void;
}

export const DEFAULT_WORKSPACE_COLOR = '#6161ff';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_LOCALE = 'en';

/** First user-perceived character of the name, upper-cased, as the workspace avatar letter. */
export function workspaceIconFor(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toUpperCase() : 'A';
}

/**
 * Idempotent bootstrap (architecture section 8): ensure `users/{uid}` exists and that the user has a
 * workspace, creating a personal one with the caller as sole owner when they have none. Safe to call
 * on every sign-in; run it inside a Firestore transaction so concurrent calls cannot double-create.
 */
export async function bootstrapUserInTransaction(
  tx: BootstrapTx,
  identity: Identity,
  hints: BootstrapUserRequest,
  serverTimestamp: ServerTimestampSentinel,
): Promise<BootstrapUserResult> {
  const { uid } = identity;
  const user = await tx.getUser(uid);

  // Fast path: the remembered workspace is still valid for this user.
  if (user?.lastWorkspaceId && (await tx.workspaceHasMember(user.lastWorkspaceId, uid))) {
    return { workspaceId: user.lastWorkspaceId };
  }

  // Otherwise reuse any workspace the user already belongs to before creating a new one.
  const existingId = await tx.findMemberWorkspaceId(uid);
  const workspaceId = existingId ?? tx.newWorkspaceId();

  if (!existingId) {
    const name = personalWorkspaceName(identity.displayName, identity.email);
    tx.createWorkspace(workspaceId, {
      name,
      description: '',
      icon: workspaceIconFor(name),
      color: DEFAULT_WORKSPACE_COLOR,
      ownerId: uid,
      memberIds: [uid],
      roles: { [uid]: 'owner' },
      kind: 'open',
      createdAt: serverTimestamp,
      createdBy: uid,
      updatedAt: serverTimestamp,
    });
  }

  if (user) {
    tx.setLastWorkspace(uid, workspaceId);
  } else {
    tx.createUser(uid, {
      displayName: identity.displayName ?? identity.email ?? '',
      email: identity.email ?? '',
      photoURL: identity.photoURL,
      timezone: hints.timezone ?? DEFAULT_TIMEZONE,
      locale: hints.locale ?? DEFAULT_LOCALE,
      lastWorkspaceId: workspaceId,
      theme: 'system',
      createdAt: serverTimestamp,
    });
  }

  return { workspaceId };
}
