import { getFormRequestSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { db } from '../lib/admin';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminFormsReads } from '../lib/admin-forms';
import { getFormForVisitor } from '../lib/forms';

/**
 * The public face of a form for any signed-in user, member of the board or not: the title, the
 * thank-you text and the questions, only while the form accepts responses. Nothing else about the
 * board leaves the server.
 */
export const getForm = onCall(async (request) => {
  actorFromRequest(request);
  const input = parseInput(getFormRequestSchema, request.data, 'getForm');
  return getFormForVisitor(adminFormsReads(db()), input);
});
