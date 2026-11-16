import { formatFileSize } from '@atrium/shared';
import { Icon } from '@vibe/core';
import { memo } from 'react';
import {
  columnFileKey,
  fetchColumnFileUrl,
  fetchUpdateFileUrl,
  openColumnFile,
  openUpdateFile,
  updateFileKey,
} from '../../lib/file-open';
import { formatRelativeShort } from '../../lib/format';
import { LazyThumbnail } from '../files/LazyThumbnail';
import { attachmentIcon, isImageType } from '../item-card/update-attachments';
import { fileExtensionLabel, type FileCard as FileCardModel } from './files-view-model';
import styles from './files-view.module.css';

interface FileCardProps {
  boardId: string;
  card: FileCardModel;
  onOpenItem: (itemId: string) => void;
  /** Display name of a user id (the author of an update or reply). */
  userName?: (uid: string) => string | undefined;
}

/** One file: a thumbnail button (opens the file), its name, its item and a meta line. */
export const FileCard = memo(function FileCard({
  boardId,
  card,
  onOpenItem,
  userName,
}: FileCardProps) {
  const { file } = card;
  const fromUpdate = card.source !== 'column';
  const target = { boardId, itemId: card.itemId, columnId: card.columnId, fileId: file.id };
  const updateTarget = {
    boardId,
    itemId: card.itemId,
    updateId: card.updateId,
    replyId: card.replyId,
    fileId: file.id,
  };
  const uploaded = formatRelativeShort({ toMillis: () => Date.parse(file.uploadedAt) });
  const author = fromUpdate ? userName?.(card.authorId) : undefined;
  const label = fromUpdate
    ? `${card.source === 'reply' ? 'Reply' : 'Update'}${author ? ` by ${author}` : ''}`
    : card.columnTitle;
  const meta = [label, formatFileSize(file.size), uploaded].filter(Boolean).join(' · ');
  const image = isImageType(file.mimeType);

  return (
    <li className={styles.card}>
      <button
        type="button"
        className={styles.thumbButton}
        aria-label={`Open ${file.name}`}
        onClick={() =>
          void (fromUpdate
            ? openUpdateFile(updateTarget, 'Could not open the file. Try again.')
            : openColumnFile(target, 'Could not open the file. Try again.'))
        }
      >
        <span className={styles.thumb}>
          {image ? (
            <LazyThumbnail
              cacheKey={fromUpdate ? updateFileKey(updateTarget) : columnFileKey(target)}
              mimeType={file.mimeType}
              fetchUrl={() =>
                fromUpdate ? fetchUpdateFileUrl(updateTarget) : fetchColumnFileUrl(target)
              }
              className={styles.imageWrap}
              imageClassName={styles.image}
              iconSize={32}
            />
          ) : (
            <>
              <Icon icon={attachmentIcon(file.mimeType)} size={32} aria-hidden />
              <span className={styles.ext}>{fileExtensionLabel(file.name)}</span>
            </>
          )}
        </span>
      </button>
      <span className={styles.name} title={file.name}>
        {file.name}
      </span>
      <button
        type="button"
        className={styles.item}
        title={card.itemName}
        onClick={() => onOpenItem(card.itemId)}
      >
        {card.itemName}
      </button>
      <span className={styles.meta} title={meta}>
        {meta}
      </span>
    </li>
  );
});
