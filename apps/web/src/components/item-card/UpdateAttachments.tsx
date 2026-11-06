import { formatFileSize, type FileAttachment } from '@atrium/shared';
import { Icon, IconButton } from '@vibe/core';
import { Close } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useRef, useState } from 'react';
import { describeCallableError, updateAttachmentCalls } from '../../lib/callables';
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

/** A thumbnail, fetched through the callable only once the chip scrolls into view. */
function Thumbnail({
  target,
  attachment,
}: {
  target: AttachmentTarget;
  attachment: FileAttachment;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (visible || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    updateAttachmentCalls
      .getUrl({ ...target, fileId: attachment.id })
      .then((res) => {
        if (!cancelled) setUrl(res.downloadUrl);
      })
      .catch(() => undefined); // the type icon stays
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one fetch per file
  }, [visible, attachment.id]);

  return (
    <span ref={ref} className={styles.thumb}>
      {url ? (
        <img className={styles.thumbImage} src={url} alt="" />
      ) : (
        <Icon icon={attachmentIcon(attachment.mimeType)} size={16} aria-hidden />
      )}
    </span>
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
