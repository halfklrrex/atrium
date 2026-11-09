import {
  normalizeEmail,
  personalWorkspaceName,
  type BootstrapUserRequest,
  type AccountStatus,
  type BootstrapUserResult,
  type ServerTimestampSentinel,
  type UserWrite,
  type WorkspaceWrite,
} from '@atrium/shared';
import type { MemberProfile } from './membership';

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
  getUser(
    uid: string,
  ): Promise<{ lastWorkspaceId: string | null; accountStatus?: AccountStatus | null } | null>;
  workspaceHasMember(workspaceId: string, uid: string): Promise<boolean>;
  findMemberWorkspaceId(uid: string): Promise<string | null>;
  newWorkspaceId(): string;
  createUser(uid: string, data: UserWrite): void;
  setLastWorkspace(uid: string, workspaceId: string): void;
  createWorkspace(workspaceId: string, data: WorkspaceWrite): void;
  /** Writes the owner's `members/{uid}` profile doc for a workspace created in this transaction. */
  createMember(workspaceId: string, uid: string, profile: MemberProfile): void;
}

export const DEFAULT_WORKSPACE_COLOR = '#6161ff';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_LOCALE = 'en';

/** First user-perceived character of the name, upper-cased, as the workspace avatar letter. */
export function workspaceIconFor(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toUpperCase() : 'A';
}

export interface BootstrapOptions {
  /**
   * `ACCOUNT_APPROVAL_REQUIRED` (ADMIN-2). Off by default: a new user doc is created already
   * `approved` and everything else is as before. On: a new user doc is `pending` and gets no
   * workspace until an admin approves. An existing pending or blocked user gets none either, with
   * the flag on or off.
   */
  approvalRequired?: boolean;
  /** Called (inside the transaction body, once per attempt) when this call creates the user doc. */
  onUserCreated?: () => void;
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
  options: BootstrapOptions = {},
): Promise<BootstrapUserResult> {
  const { uid } = identity;
  const approvalRequired = options.approvalRequired === true;
  const user = await tx.getUser(uid);

  if (approvalRequired) {
    // Waiting (or blocked) accounts get no workspace; admins create it on approval.
    if (!user) {
      tx.createUser(uid, {
        displayName: identity.displayName ?? identity.email ?? '',
        email: identity.email ?? '',
        photoURL: identity.photoURL,
        timezone: hints.timezone ?? DEFAULT_TIMEZONE,
        locale: hints.locale ?? DEFAULT_LOCALE,
        lastWorkspaceId: null,
        theme: 'system',
        createdAt: serverTimestamp,
        accountStatus: 'pending',
        statusChangedAt: serverTimestamp as never,
        statusChangedBy: 'system:bootstrap',
      });
      options.onUserCreated?.();
      return { accountStatus: 'pending' };
    }
  }
  // A pending or blocked profile gets no workspace and no write, whatever the approval flag says:
  // turning the flag off must not let a blocked person create a workspace. Profiles without a
  // status (older accounts) behave as before.
  if (user?.accountStatus === 'pending' || user?.accountStatus === 'blocked') {
    return { accountStatus: user.accountStatus };
  }

  // Fast path: the remembered workspace is still valid for this user.
  if (user?.lastWorkspaceId && (await tx.workspaceHasMember(user.lastWorkspaceId, uid))) {
    return withStatus({ workspaceId: user.lastWorkspaceId }, approvalRequired, user.accountStatus);
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
    tx.createMember(workspaceId, uid, {
      displayName: identity.displayName ?? identity.email ?? '',
      photoURL: identity.photoURL,
      email: identity.email ? normalizeEmail(identity.email) : '',
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
      // Accounts created before the gate ships are already approved (the claim is set after commit).
      accountStatus: 'approved',
      statusChangedAt: serverTimestamp as never,
      statusChangedBy: 'system:bootstrap',
    });
    options.onUserCreated?.();
  }

  return withStatus({ workspaceId }, approvalRequired, user ? user.accountStatus : 'approved');
}

/** Adds `accountStatus` to the result only when approval is required (flag off: result unchanged). */
function withStatus(
  result: BootstrapUserResult,
  approvalRequired: boolean,
  status: AccountStatus | null | undefined,
): BootstrapUserResult {
  return approvalRequired && status ? { ...result, accountStatus: status } : result;
}
