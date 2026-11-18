import { NOTIFICATION_LIMITS } from '@atrium/shared';
import { notificationId, type NotificationStore } from '../lib/notifications';

/**
 * Tells the webhook's creator (a board owner) that it was switched off after too many failures: one
 * `webhook_disabled` card in the bell. `recipeName` carries the webhook's name (the card text reads
 * "Turned off webhook ..."), and `itemId` the webhook id. One card per switch-off (`at` is in the id).
 */
export async function notifyWebhookDisabled(
  store: Pick<NotificationStore, 'getBoard' | 'createNotification'>,
  notice: {
    boardId: string;
    webhookId: string;
    webhookName: string;
    ownerUid: string;
    reason: string;
    at: number;
  },
): Promise<boolean> {
  const board = await store.getBoard(notice.boardId);
  if (!board) return false;
  return await store.createNotification(
    notice.ownerUid,
    notificationId('webhook_disabled', `${notice.webhookId}-${notice.at}`, notice.ownerUid),
    {
      kind: 'webhook_disabled',
      actorId: notice.ownerUid,
      actorName: 'Atrium',
      actorPhotoURL: null,
      workspaceId: board.workspaceId,
      boardId: notice.boardId,
      boardName: board.name,
      itemId: notice.webhookId,
      itemName: notice.webhookName,
      updateId: null,
      replyId: null,
      columnId: null,
      recipeName: notice.webhookName.slice(0, 80),
      snippet: notice.reason.slice(0, NOTIFICATION_LIMITS.snippet),
    },
  );
}
