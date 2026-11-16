import { formatFileSize, type FileAttachment } from '@atrium/shared';
import { Icon, IconButton } from '@vibe/core';
import { Close } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { describeCallableError, updateAttachmentCalls } from '../../lib/callables';
import { LazyThumbnail } from '../files/LazyThumbnail';
import { showToast } from '../toast-store';
import { attachmentIcon, isImageType, type AttachmentTarget } from './update-attachments';
import styles from './UpdateAttachments.module.css';

interface UpdateAttachmentsProps {
  target: AttachmentTarget;
  attachments: readonly FileAttachment[] | undefined;
  /** Whether the signed-in user may remove this attachment (its author, or a board owner). */
  canRemove: (attachment: FileAttachment) => boolean;
  /** Inside a reply bubble: no card padding around the row. */
  compact?: boolean;
}

/** A chip thumbnail: fetched through the callable only once it scrolls into view. */
function Thumbnail({
  target,
  attachment,
}: {
  target: AttachmentTarget;
  attachment: FileAttachment;
}) {
  return (
    <LazyThumbnail
      cacheKey={`update/${target.boardId}/${target.itemId}/${target.updateId}/${target.replyId ?? ''}/${attachment.id}`}
      mimeType={attachment.mimeType}
      fetchUrl={() => updateAttachmentCalls.getUrl({ ...target, fileId: attachment.id })}
      className={styles.thumb}
      imageClassName={styles.thumbImage}
    />
  );
}

/** The row of file chips under an update or a reply. */
export function UpdateAttachments({
  target,
  attachments,
  canRemove,
  compact = false,
}: UpdateAttachmentsProps) {
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  if (!attachments || attachments.length === 0) return null;

  const download = async (file: FileAttachment) => {
    try {
      const res = await updateAttachmentCalls.getUrl({ ...target, fileId: file.id });
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showToast(describeCallableError(error, 'Could not download the file. Try again.'), {
        type: 'negative',
      });
    }
  };

  const remove = async (file: FileAttachment) => {
    setRemoving((prev) => new Set(prev).add(file.id));
    try {
      await updateAttachmentCalls.remove({ ...target, fileId: file.id });
    } catch (error) {
      showToast(describeCallableError(error, 'Could not remove the file. Try again.'), {
        type: 'negative',
      });
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  };

  return (
    <ul className={classNames(styles.list, compact && styles.compact)} aria-label="Attachments">
      {attachments.map((file) => (
        <li key={file.id} className={styles.chip}>
          <button
            type="button"
            className={styles.open}
            title={`Download ${file.name}`}
            aria-label={`Download ${file.name}`}
            onClick={() => void download(file)}
          >
            {isImageType(file.mimeType) ? (
              <Thumbnail target={target} attachment={file} />
            ) : (
              <span className={styles.thumb}>
                <Icon icon={attachmentIcon(file.mimeType)} size={16} aria-hidden />
              </span>
            )}
            <span className={styles.name}>{file.name}</span>
            <span className={styles.size}>{formatFileSize(file.size)}</span>
          </button>
          {canRemove(file) ? (
            <IconButton
              icon={Close}
              size="xxs"
              kind="tertiary"
              aria-label={`Remove ${file.name}`}
              disabled={removing.has(file.id)}
              onClick={() => void remove(file)}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
