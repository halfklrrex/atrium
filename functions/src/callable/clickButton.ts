import { clickButtonRequestSchema, clickButtonResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { db } from '../lib/admin';
import { runClickButton } from '../lib/click-button';

export const clickButton = onCall(async (request) => {
  const { uid } = actorFromRequest(request);
  const parsed = clickButtonRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid clickButton request.', parsed.error.issues);
  }
  const { notified: _notified, ...result } = await runClickButton(db(), uid, parsed.data);
  void _notified;
  return clickButtonResultSchema.parse(result);
});
