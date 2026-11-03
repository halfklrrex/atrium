import { clickButtonRequestSchema, clickButtonResultSchema } from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminColumnActionsTx, db } from '../lib/admin';
import { adminNotificationStore } from '../lib/admin-notifications';
import { clickButtonInTransaction } from '../lib/column-actions';
import { deliverButtonNotifications } from '../lib/notifications';

export const clickButton = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const { uid } = request.auth;
  const parsed = clickButtonRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid clickButton request.', parsed.error.issues);
  }

  const firestore = db();
  const { notify, ...result } = await firestore.runTransaction((tx) =>
    clickButtonInTransaction(
      adminColumnActionsTx(firestore, tx),
      uid,
      parsed.data,
      FieldValue.serverTimestamp(),
    ),
  );

  // After the commit, best effort: the item changes are already applied, so a delivery failure is
  // logged and never fails the click.
  if (notify) {
    try {
      const notified = await deliverButtonNotifications(adminNotificationStore(firestore), {
        activityId: result.activityId,
        boardId: parsed.data.boardId,
        itemId: parsed.data.itemId,
        actorId: uid,
        columnId: notify.columnId,
        buttonLabel: notify.buttonLabel,
        itemName: notify.itemName,
        targets: notify.targets,
      });
      await firestore
        .collection('boards')
        .doc(parsed.data.boardId)
        .collection('activity')
        .doc(result.activityId)
        .update({ 'data.notified': notified });
    } catch (error) {
      logger.error('Button notifications failed', {
        boardId: parsed.data.boardId,
        itemId: parsed.data.itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return clickButtonResultSchema.parse(result);
});
