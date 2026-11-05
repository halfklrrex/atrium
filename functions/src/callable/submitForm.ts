import { submitFormRequestSchema, submitFormResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { db } from '../lib/admin';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminFormsTx } from '../lib/admin-forms';
import { submitFormInTransaction } from '../lib/forms';

/**
 * Turns a form response into an item in the form's target group. Open to any signed-in user; the
 * submitter is recorded as the item's author and gains no access to the board. Never returns the
 * item id.
 */
export const submitForm = onCall(async (request) => {
  const { uid } = actorFromRequest(request);
  const input = parseInput(submitFormRequestSchema, request.data, 'submitForm');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    submitFormInTransaction(adminFormsTx(firestore, tx), uid, input),
  );
  return submitFormResultSchema.parse(result);
});
