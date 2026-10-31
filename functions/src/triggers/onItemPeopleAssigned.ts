import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminItemIndexWriter } from '../lib/admin-item-index';
import { adminNotificationStore } from '../lib/admin-notifications';
import { syncItemIndexFields, withSharedBoardRead } from '../lib/item-index';
import { notifyDescriptionMentions, notifyPeopleAssigned } from '../lib/notifications';

/**
 * Item-write side effects. The name is older than the job (keeping it avoids a delete and recreate
 * on deploy). It first maintains the item's server-side index fields (`assigneeUids`, `nameTokens`,
 * never `updatedAt` / `updatedBy`), then sends `assigned` notifications (someone was added to a
 * People column, also on create) and `mention` notifications (a new @ chip in the description).
 * Every step returns without reading anything unless its inputs changed, and the index and the
 * assigned notifications share one read of the board.
 */
export const onItemPeopleAssigned = onDocumentWritten(
  {
    // `database` is required: a trigger without it listens to the project's default database only.
    document: 'boards/{boardId}/items/{itemId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const before = event.data?.before;
    const change = {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      ...(before?.exists ? { before: before.data() ?? {} } : {}),
      after: after.data() ?? {},
    };
    const firestore = db();
    const store = withSharedBoardRead(adminNotificationStore(firestore));
    const indexed = await syncItemIndexFields(
      { getBoard: (boardId) => store.getBoard(boardId), ...adminItemIndexWriter(firestore) },
      { ...change, updateTime: after.updateTime },
    );
    if (indexed) logger.info(`Indexed item ${event.params.boardId}/${event.params.itemId}`);
    const assigned = await notifyPeopleAssigned(store, change);
    if (assigned > 0) {
      logger.info(`Assigned notifications for ${event.params.itemId}`, { created: assigned });
    }
    const mentioned = await notifyDescriptionMentions(store, change);
    if (mentioned > 0) {
      logger.info(`Description mention notifications for ${event.params.itemId}`, {
        created: mentioned,
      });
    }
  },
);
