import { sendInboxMessageRequestSchema, sendInboxMessageResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminInboxAuth, adminInboxStore } from '../lib/admin-inbox';
import { sendInboxMessage as run } from '../lib/inbox';

/**
 * The sender side of the Inbox (ADMIN-4): send feedback, send an appeal, or reply on your own thread.
 * One of the two callables that accept a blocked caller (a blocked person appeals); the per-action
 * rules (blocked: appeals only; approved: feedback only; pending: nothing) are in `lib/inbox.ts`.
 */
export const sendInboxMessage = onCall(async (request) => {
  const actor = actorFromRequest(request, { allow: ['approved', 'blocked'] });
  const input = parseInput(sendInboxMessageRequestSchema, request.data, 'sendInboxMessage');
  const result = await run(
    { store: adminInboxStore(db()), auth: adminInboxAuth() },
    {
      uid: actor.uid,
      displayName: actor.displayName,
      email: actor.email,
      photoURL: actor.photoURL,
      accountStatus: actor.accountStatus,
    },
    input,
  );
  return sendInboxMessageResultSchema.parse(result);
});
