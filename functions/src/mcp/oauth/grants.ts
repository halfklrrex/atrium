import type { RevokeMcpGrantRequest, RevokeMcpGrantResult } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { writeMcpAudit } from './audit';
import type { McpGrantRef, McpStore } from './store';

/**
 * Grant revocation (OPS4 section 4.4): Settings -> Disconnect, `/revoke`, an admin block, and a
 * replayed code or reused refresh token all end here. The grant's token documents are deleted (so
 * `verifyAccessToken` fails at once), `revokedAt` is set (so the Connected apps card hides it) and
 * an audit row is written.
 */

/** Revokes one grant; false when it was already revoked. */
export async function revokeGrant(
  store: McpStore,
  now: number,
  ref: McpGrantRef,
): Promise<boolean> {
  if (ref.doc.revokedAt !== null) return false;
  const hashes = await store.listGrantTokenHashes(ref.grantId);
  await store.deleteTokens(hashes);
  await store.updateGrant(ref.uid, ref.grantId, { revokedAt: now });
  await writeMcpAudit(store, now, {
    kind: 'grant_revoked',
    uid: ref.uid,
    clientId: ref.doc.clientId,
    grantId: ref.grantId,
  });
  return true;
}

/** The `revokeMcpGrant` callable: a person disconnects one of their own apps. */
export async function revokeMcpGrant(
  store: McpStore,
  now: number,
  uid: string,
  input: RevokeMcpGrantRequest,
): Promise<RevokeMcpGrantResult> {
  const doc = await store.getGrant(uid, input.grantId);
  if (!doc) throw new HttpsError('not-found', 'No such connected app.');
  const revoked = await revokeGrant(store, now, { uid, grantId: input.grantId, doc });
  return { grantId: input.grantId, revoked };
}

/** Every active grant of one account (admin block). Returns how many were revoked. */
export async function revokeAllMcpGrants(
  store: McpStore,
  now: number,
  uid: string,
): Promise<number> {
  const grants = await store.listActiveGrants(uid);
  let count = 0;
  for (const ref of grants) if (await revokeGrant(store, now, ref)) count += 1;
  return count;
}
