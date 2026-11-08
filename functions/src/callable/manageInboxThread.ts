import { manageInboxThreadRequestSchema, manageInboxThreadResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { assertAdminToken } from '../lib/account-admin';
import { db } from '../lib/admin';
import { adminInboxAuth, adminInboxStore } from '../lib/admin-inbox';
import { manageInboxThread as run } from '../lib/inbox';

/** The admin side of the Inbox (ADMIN-4): reply, close, reopen, keep blocked, delete. Site admins only. */
export const manageInboxThread = onCall(async (request) => {
  const actor = actorFromRequest(request);
  // The verified token's `admin` claim, checked before the input is even parsed.
  assertAdminToken(actor.claims);
  const input = parseInput(manageInboxThreadRequestSchema, request.data, 'manageInboxThread');
  const result = await run(
    { store: adminInboxStore(db()), auth: adminInboxAuth() },
    { uid: actor.uid },
    input,
  );
  return manageInboxThreadResultSchema.parse(result);
});
