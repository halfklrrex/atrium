import { Icon } from '@vibe/core';
import { File as FileIcon } from '@vibe/icons';
import { formatRelativeShort } from '../../lib/format';
import { authorLabel } from '../../lib/automation-actor';
import type { BoardDoc, ItemDoc, ItemUpdateDoc } from '../../data';
import type { TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import { ItemCell } from '../item-view/ItemCell';
import styles from './ItemFilesTab.module.css';
import { UpdateAttachments } from './UpdateAttachments';
import { canRemoveAttachment } from './update-attachments';

interface ItemFilesTabProps {
  board: BoardDoc;
  item: ItemDoc;
  uid: string;
  /** Every board column in board order. */
  columns: readonly ColumnView[];
  ctx: TableCtx;
  canEdit: boolean;
  /** Board owners may remove any attachment. */
  canManage: boolean;
  /** The item's updates, newest first (already listened to by the panel). */
  updates: readonly ItemUpdateDoc[];
}

/**
 * Every file on the item: the files columns (live cells, so upload, download and remove work as
 * in the table) and the attachments on its updates. Reply attachments are not listed.
 */
export function ItemFilesTab({
  board,
  item,
  uid,
  columns,
  ctx,
  canEdit,
  canManage,
  updates,
}: ItemFilesTabProps) {
  const fileColumns = columns.filter((c) => c.def.type === 'files');
  const withAttachments = updates.filter((u) => (u.attachments?.length ?? 0) > 0);

  if (fileColumns.length === 0 && withAttachments.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIconWrap}>
          <Icon icon={FileIcon} size={28} aria-hidden />
        </div>
        <h3 className={styles.emptyTitle}>No files yet</h3>
        <p className={styles.emptyBody}>
          Files added to this item&apos;s file columns or to its updates show up here.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.files}>
      {fileColumns.length > 0 && (
        <section className={styles.section} aria-labelledby="item-files-columns">
          <h3 id="item-files-columns" className={styles.sectionTitle}>
            In columns
          </h3>
          {fileColumns.map((column) => (
            <div key={column.def.id} className={styles.columnBlock}>
              <span className={styles.columnLabel} title={column.def.title}>
                {column.def.title}
              </span>
              <ItemCell item={item} column={column} ctx={ctx} canEdit={canEdit} />
            </div>
          ))}
        </section>
      )}

      {withAttachments.length > 0 && (
        <section className={styles.section} aria-labelledby="item-files-updates">
          <h3 id="item-files-updates" className={styles.sectionTitle}>
            In updates
          </h3>
          {withAttachments.map((update) => (
            <div key={update.id} className={styles.updateBlock}>
              <p className={styles.updateMeta}>
                <span className={styles.author}>
                  {authorLabel(update.authorId, update.authorName, uid)}
                </span>
                <span className={styles.time}>{formatRelativeShort(update.createdAt)}</span>
              </p>
              <UpdateAttachments
                target={{ boardId: board.id, itemId: item.id, updateId: update.id }}
                attachments={update.attachments}
                canRemove={(file) =>
                  canRemoveAttachment({
                    uid,
                    canManage,
                    uploadedBy: file.uploadedBy,
                    authorId: update.authorId,
                  })
                }
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
