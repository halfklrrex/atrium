import { setAccountStatusRequestSchema, setAccountStatusResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { assertAdminToken, setAccountStatus as run } from '../lib/account-admin';
import { db } from '../lib/admin';
import { adminAccountAuth, adminAccountStore } from '../lib/admin-account';

/** Approve, block or unblock an account. Site admins only (the `admin` claim in the verified token). */
export const setAccountStatus = onCall(async (request) => {
  const actor = actorFromRequest(request);
  assertAdminToken(actor.claims);
  const input = parseInput(setAccountStatusRequestSchema, request.data, 'setAccountStatus');
  const result = await run(
    { auth: adminAccountAuth(), store: adminAccountStore(db()) },
    { uid: actor.uid, displayName: actor.displayName },
    input,
  );
  return setAccountStatusResultSchema.parse(result);
});
