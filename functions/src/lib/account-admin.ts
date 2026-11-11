import {
  ACCOUNT_CLAIM,
  LIST_ACCOUNTS_PAGE_SIZE,
  accountStatusFromClaims,
  isAdminClaims,
  mergeAccountClaims,
  type AccountListItem,
  type AccountStatus,
  type ListAccountsRequest,
  type ListAccountsResult,
  type SetAccountStatusRequest,
  type SetAccountStatusResult,
} from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Identity } from './bootstrap';
import { notificationId, type NewNotification, type NotificationStore } from './notifications';

/**
 * Site admin actions (ADMIN-2, docs/specs/ADMIN-site-admin-role.md): approve, block and unblock
 * accounts, and list them. The logic takes narrow Auth and Firestore interfaces so it is unit
 * tested without an emulator; `admin-account.ts` adapts the Admin SDK to them.
 */

/** The slice of an Auth user record these functions need. */
export interface AuthAccount {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  disabled: boolean;
  claims: Record<string, unknown>;
  /** ISO 8601, null when unknown. */
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AccountAuth {
  /** `null` when there is no such Auth user. */
  getUser(uid: string): Promise<AuthAccount | null>;
  /** Replaces the user's custom claims. */
  setClaims(uid: string, claims: Record<string, unknown>): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  listUsers(
    pageSize: number,
    pageToken?: string,
  ): Promise<{ users: AuthAccount[]; nextPageToken: string | null }>;
  /** Uids that carry `admin: true` (pages through every Auth user). */
  listAdminUids(): Promise<string[]>;
}

export interface AccountAuditEntry {
  actorUid: string;
  targetUid: string;
  action: 'approve' | 'block' | 'unblock';
  /** Statuses before and after, so the log reads on its own. No emails or names are stored. */
  from: AccountStatus;
  to: AccountStatus;
}

export interface AccountStore {
  /** `users/{uid}.accountStatus`, `null` when the doc or the field is missing. */
  getAccountStatuses(uids: ReadonlyArray<string>): Promise<Map<string, AccountStatus>>;
  /** Creates the personal workspace when the person has none (and the user doc when missing). */
  ensurePersonalWorkspace(identity: Identity): Promise<string>;
  /** Writes `accountStatus`, `statusChangedAt` (server time) and `statusChangedBy` on `users/{uid}`. */
  setAccountStatus(uid: string, status: AccountStatus, changedBy: string): Promise<void>;
  /** Appends to `system/accountAudit/entries` with a server timestamp. */
  appendAudit(entry: AccountAuditEntry): Promise<void>;
  createNotification: NotificationStore['createNotification'];
  /**
   * Closes this person's open or answered appeals with `outcome: 'unblocked'` (ADMIN-4). Called on
   * approve and unblock only, after the claim; the caller treats a failure as non-fatal.
   */
  closeOpenAppeals(uid: string): Promise<unknown>;
  /** Deletes `users/{uid}/pushTokens` so a blocked account gets no more pushes. */
  deletePushTokens(uid: string): Promise<unknown>;
  /** Revokes every MCP connection of a blocked account (OPS4 section 4.4); best effort. */
  revokeMcpGrants(uid: string): Promise<unknown>;
}

/** Placeholder ids for notification fields that point at boards; account notices have none. */
export const ACCOUNT_NOTIFICATION_REF = 'account';

const statusOf = (account: AuthAccount): AccountStatus => accountStatusFromClaims(account.claims);

/** Only the `admin` claim in the verified token counts; never anything the client sent. */
export function assertAdminToken(token: Record<string, unknown> | null | undefined): void {
  if (!isAdminClaims(token)) {
    throw new HttpsError('permission-denied', 'Only a site admin can do this.');
  }
}

export interface Caller {
  uid: string;
  displayName: string | null;
}

async function closeAppealsBestEffort(store: AccountStore, uid: string): Promise<void> {
  try {
    await store.closeOpenAppeals(uid);
  } catch (error) {
    logger.error('Could not close the open appeals of an approved account', { uid, error });
  }
}

/**
 * Approve (also unblock) or block one account. A repeat of the state it is already in is a no-op.
 * Idempotent under retries. Approve writes the claim, which the rules read, last; block writes it
 * first and the user document last (see the steps below). A half-finished attempt is finished by the
 * next call.
 */
export async function setAccountStatus(
  deps: { auth: AccountAuth; store: AccountStore },
  caller: Caller,
  input: SetAccountStatusRequest,
): Promise<SetAccountStatusResult> {
  const { auth, store } = deps;
  const { uid, status } = input;

  if (status === 'blocked' && uid === caller.uid) {
    throw new HttpsError('failed-precondition', 'You cannot block your own account.', {
      reason: 'self-block',
    });
  }

  const target = await auth.getUser(uid);
  if (!target) throw new HttpsError('not-found', 'No such account.');

  const from = statusOf(target);
  // A no-op only when the claim, the user document and the target all agree. The Auth `disabled`
  // flag does not count (blocking no longer disables the user), so a half-finished block (claim set,
  // document not yet) or a missing document field is finished by a retry.
  const docStatus = (await store.getAccountStatuses([uid])).get(uid) ?? null;
  if (from === status && docStatus === status) {
    // An unblock retried after a failed appeal close still closes the appeals (best effort).
    if (status === 'approved') await closeAppealsBestEffort(store, uid);
    return { uid, status, changed: false };
  }

  if (status === 'blocked' && isAdminClaims(target.claims)) {
    const admins = await auth.listAdminUids();
    if (!admins.some((adminUid) => adminUid !== uid)) {
      throw new HttpsError('failed-precondition', 'You cannot block the last admin.', {
        reason: 'last-admin',
      });
    }
  }

  if (status === 'approved') {
    const workspaceId = await store.ensurePersonalWorkspace({
      uid,
      displayName: target.displayName,
      email: target.email,
      photoURL: target.photoURL,
    });
    await store.setAccountStatus(uid, 'approved', caller.uid);
    if (target.disabled) await auth.setDisabled(uid, false);
    // The claim is last: it is what opens the rules, and a retry re-runs the steps above.
    await auth.setClaims(uid, mergeAccountClaims(target.claims, 'approved'));
    // Best effort (ADMIN-4): a failure is logged and never fails the unblock. Pressing Unblock
    // again (the no-op path above) closes whatever is still open.
    await closeAppealsBestEffort(store, uid);
    if (from === 'pending') {
      const doc: NewNotification = {
        kind: 'account_approved',
        actorId: caller.uid,
        actorName: (caller.displayName ?? 'An admin').slice(0, 200),
        actorPhotoURL: null,
        workspaceId,
        boardId: ACCOUNT_NOTIFICATION_REF,
        boardName: '',
        itemId: ACCOUNT_NOTIFICATION_REF,
        itemName: '',
        updateId: null,
        replyId: null,
        columnId: null,
        snippet: '',
      };
      await store.createNotification(uid, notificationId('account_approved', uid, uid), doc);
    }
  } else {
    // Order matters (docs/specs/ADMIN-4-appeals-inbox.md, "setAccountStatus after"):
    // 1. claims first, so any token minted after the revoke carries `blocked`. A blocked admin loses
    //    the admin claim too (`setAccountStatus` checks the token's `admin` claim);
    await auth.setClaims(uid, mergeAccountClaims(target.claims, 'blocked', false));
    // 2. revoke the refresh tokens, so an open client's forced refresh fails;
    await auth.revokeRefreshTokens(uid);
    // 3. the user document last: an open client listens to it, and by then the refresh is revoked.
    await store.setAccountStatus(uid, 'blocked', caller.uid);
    // Best effort: `sendPush` also refuses blocked accounts, this just removes the devices.
    try {
      await store.deletePushTokens(uid);
    } catch (error) {
      logger.error('Could not delete the push tokens of a blocked account', { uid, error });
    }
    // Best effort too: `/mcp` and `/token` also refuse a blocked account, this just ends the grants.
    try {
      await store.revokeMcpGrants(uid);
    } catch (error) {
      logger.error('Could not revoke the MCP grants of a blocked account', { uid, error });
    }
    // The Auth user is NOT disabled: the person can sign in and see the blocked screen. Never touch
    // `disabled` here (an account an operator disabled in the console stays disabled).
  }

  await store.appendAudit({
    actorUid: caller.uid,
    targetUid: uid,
    action: status === 'blocked' ? 'block' : from === 'blocked' ? 'unblock' : 'approve',
    from,
    to: status,
  });
  return { uid, status, changed: true };
}

/**
 * One page of accounts for the admin screen. The status is `users/{uid}.accountStatus`; an account
 * without one is approved only when its `acct` claim says so (blocked likewise), otherwise pending.
 */
export async function listAccounts(
  deps: { auth: AccountAuth; store: Pick<AccountStore, 'getAccountStatuses'> },
  input: ListAccountsRequest,
): Promise<ListAccountsResult> {
  const pageSize = input.pageSize ?? LIST_ACCOUNTS_PAGE_SIZE.default;
  const { users, nextPageToken } = await deps.auth.listUsers(pageSize, input.pageToken);
  const statuses = await deps.store.getAccountStatuses(users.map((u) => u.uid));
  const accounts: AccountListItem[] = users.map((u) => ({
    uid: u.uid,
    displayName: u.displayName,
    email: u.email,
    photoURL: u.photoURL,
    status:
      statuses.get(u.uid) ?? accountStatusFromClaims({ [ACCOUNT_CLAIM]: u.claims[ACCOUNT_CLAIM] }),
    createdAt: u.createdAt,
    lastSignInAt: u.lastSignInAt,
  }));
  return { accounts, nextPageToken };
}

// -- bootstrapUser side effects ------------------------------------------------------------------

export interface BootstrapAccountDeps {
  auth: Pick<AccountAuth, 'getUser' | 'setClaims' | 'listAdminUids'>;
  createNotification: NotificationStore['createNotification'];
}

/**
 * What `bootstrapUser` does after it created a user doc.
 * Flag off: the account is already `approved` in its doc, so give it the `acct: approved` claim
 * (other claims kept). A failure is logged by the caller and never breaks sign-in.
 * Flag on: the account is pending with no claim, so tell every admin.
 */
export async function afterUserCreated(
  deps: BootstrapAccountDeps,
  identity: Identity,
  approvalRequired: boolean,
): Promise<void> {
  if (!approvalRequired) {
    const account = await deps.auth.getUser(identity.uid);
    if (!account) return;
    await deps.auth.setClaims(identity.uid, mergeAccountClaims(account.claims, 'approved'));
    return;
  }
  const admins = await deps.auth.listAdminUids();
  const name = identity.displayName ?? identity.email ?? 'Someone';
  for (const adminUid of admins) {
    if (adminUid === identity.uid) continue;
    const doc: NewNotification = {
      kind: 'account_request',
      actorId: identity.uid,
      actorName: name.slice(0, 200),
      actorPhotoURL: identity.photoURL,
      workspaceId: ACCOUNT_NOTIFICATION_REF,
      boardId: ACCOUNT_NOTIFICATION_REF,
      boardName: '',
      itemId: identity.uid,
      itemName: '',
      updateId: null,
      replyId: null,
      columnId: null,
      snippet: '',
    };
    await deps.createNotification(
      adminUid,
      notificationId('account_request', identity.uid, adminUid),
      doc,
    );
  }
}

/**
 * ADMIN-1b self-heal: an existing account whose Auth user has no `acct` claim (it slipped through
 * the backfill) gets `acct: approved` on its next sign-in. Only when the profile says `approved`, or
 * has no status while approval is not required; never for pending or blocked profiles, never over an
 * existing claim (a `blocked` claim stays), never for a disabled Auth user. Idempotent. Returns true
 * when it wrote the claim. The caller logs failures and never lets them break sign-in.
 */
export async function healApprovedClaim(
  deps: { auth: Pick<AccountAuth, 'getUser' | 'setClaims'> },
  uid: string,
  profileStatus: AccountStatus | null | undefined,
  approvalRequired: boolean,
): Promise<boolean> {
  const profileApproved =
    profileStatus === 'approved' || (profileStatus == null && !approvalRequired);
  if (!profileApproved) return false;
  const account = await deps.auth.getUser(uid);
  if (!account || account.disabled) return false;
  if (account.claims[ACCOUNT_CLAIM] !== undefined) return false;
  await deps.auth.setClaims(uid, mergeAccountClaims(account.claims, 'approved'));
  return true;
}
