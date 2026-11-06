import { listAccountsRequestSchema, listAccountsResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { assertAdminToken, listAccounts as run } from '../lib/account-admin';
import { db } from '../lib/admin';
import { adminAccountAuth, adminAccountStore } from '../lib/admin-account';

/** One page of accounts for the admin screen. Site admins only; emails never leave through rules. */
export const listAccounts = onCall(async (request) => {
  actorFromRequest(request);
  assertAdminToken(request.auth?.token as Record<string, unknown> | undefined);
  const input = parseInput(listAccountsRequestSchema, request.data, 'listAccounts');
  const result = await run({ auth: adminAccountAuth(), store: adminAccountStore(db()) }, input);
  return listAccountsResultSchema.parse(result);
});
