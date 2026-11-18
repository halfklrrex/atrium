import type { ClickButtonRequest, ClickButtonResult } from '@atrium/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { adminColumnActionsTx } from './admin';
import { adminNotificationStore } from './admin-notifications';
import { clickButtonInTransaction } from './column-actions';
import { deliverButtonNotifications } from './notifications';

/**
 * One button click, end to end: the transaction (`clickButtonInTransaction`), then the notification
 * delivery after the commit. The `clickButton` callable and the hosted connector both run this, so
 * the actions, the repeat guard and the notifications are the same. `notified` is the number of
 * people notified (absent when the button has no notify action).
 */
export async function runClickButton(
  firestore: Firestore,
  uid: string,
  request: ClickButtonRequest,
): Promise<ClickButtonResult & { notified?: number }> {
  const { notify, ...result } = await firestore.runTransaction((tx) =>
    clickButtonInTransaction(
      adminColumnActionsTx(firestore, tx),
      uid,
      request,
      FieldValue.serverTimestamp(),
    ),
  );

  // After the commit, best effort: the item changes are already applied, so a delivery failure is
  // logged and never fails the click.
  let notified: number | undefined;
  if (notify) {
    try {
      notified = await deliverButtonNotifications(adminNotificationStore(firestore), {
        activityId: result.activityId,
        boardId: request.boardId,
        itemId: request.itemId,
        actorId: uid,
        columnId: notify.columnId,
        buttonLabel: notify.buttonLabel,
        itemName: notify.itemName,
        targets: notify.targets,
      });
      await firestore
        .collection('boards')
        .doc(request.boardId)
        .collection('activity')
        .doc(result.activityId)
        .update({ 'data.notified': notified });
    } catch (error) {
      logger.error('Button notifications failed', {
        boardId: request.boardId,
        itemId: request.itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return notified === undefined ? result : { ...result, notified };
}
