import { setMyProfileRequestSchema, setMyProfileResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminProfileStore } from '../lib/admin-profile';
import { saveMyProfile } from '../lib/profile';

/**
 * Saves the caller's profile (`users/{uid}.profile`) and copies the shared part to their member doc in
 * every workspace. Approved callers only (the default of `actorFromRequest`). Idempotent.
 */
export const setMyProfile = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(setMyProfileRequestSchema, request.data, 'setMyProfile');
  const result = await saveMyProfile(adminProfileStore(db()), actor.uid, input);
  return setMyProfileResultSchema.parse(result);
});
