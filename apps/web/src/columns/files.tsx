import {
  formatFileSize,
  isFileAllowed,
  type FileAttachment,
  type FilesSettings,
  type FilesValue,
} from '@atrium/shared';
import { Button } from '@vibe/core';
import { Add, Delete, Download, File as FileIcon } from '@vibe/icons';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { UNKNOWN_MEMBER_NAME, useUserLookup } from '../data/members-store';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { putWithProgress } from '../components/item-view/description-image-upload';
import { showToast } from '../components/toast-store';
import { describeCallableError, fileCalls } from '../lib/callables';
import styles from './cells.module.css';
import { formatDay } from './format';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps } from './types';

const VISIBLE_FILES = 2;

function formatUploadDate(iso: string): string {
  const datePart = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return formatDay(datePart);
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function explainFileDisallowed(
  file: Pick<FileAttachment, 'name' | 'mimeType' | 'size'>,
  settings: FilesSettings,
): string {
  const maxMb = settings.maxFileSizeMb ?? 50;
  if (file.size > maxMb * 1024 * 1024) {
    return `File "${file.name}" exceeds the ${maxMb} MB limit.`;
  }
  const allowed = settings.allowedTypes ?? [];
  return `File "${file.name}" does not match allowed types (${allowed.join(', ')}).`;
}

function FilesCell({ value, settings, column, ctx }: CellProps<FilesValue, FilesSettings>) {
  const lookup = useUserLookup();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const files = value?.files ?? [];
  const canAct = ctx.canAct ?? ctx.canEdit;

  const openPopover = (target: HTMLElement) => {
    if (files.length === 0 && !canAct) return;
    setAnchor(target);
    setConfirmDeleteId(null);
    setOpen(true);
  };

  const closePopover = () => {
    setOpen(false);
    setConfirmDeleteId(null);
  };

  const handleDownload = async (file: FileAttachment) => {
    if (!ctx.boardId || !ctx.itemId) return;
    try {
      const res = await fileCalls.getDownloadUrl({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
        fileId: file.id,
      });
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      showToast(describeCallableError(error, 'Could not download file. Try again.'), {
        type: 'negative',
      });
    }
  };

  const handleDelete = async (file: FileAttachment) => {
    if (!ctx.boardId || !ctx.itemId) return;
    try {
      await fileCalls.deleteAttachment({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
        fileId: file.id,
      });
      setConfirmDeleteId(null);
    } catch (error) {
      showToast(describeCallableError(error, 'Could not delete file. Try again.'), {
        type: 'negative',
      });
    }
  };

  const uploadOneFile = async (file: File) => {
    if (!ctx.boardId || !ctx.itemId) return;
    const candidate = {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    };

    if (!isFileAllowed(candidate, settings)) {
      showToast(explainFileDisallowed(candidate, settings), { type: 'negative' });
      return;
    }

    setUploadingName(file.name);
    setUploadProgress(0);
    try {
      const target = await fileCalls.requestUpload({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
        fileName: candidate.name,
        contentType: candidate.mimeType,
        size: candidate.size,
      });
      await putWithProgress(target.uploadUrl, target.headers ?? {}, file, (percent) => {
        setUploadProgress(percent);
      });
      await fileCalls.finalizeUpload({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
        fileId: target.fileId,
        fileName: candidate.name,
      });
    } catch (error) {
      showToast(describeCallableError(error, 'Could not upload file. Try again.'), {
        type: 'negative',
      });
    } finally {
      setUploadProgress(null);
      setUploadingName(null);
    }
  };

  const handleFilesSelected = async (selected: FileList | File[]) => {
    const list = Array.from(selected);
    for (const file of list) {
      await uploadOneFile(file);
    }
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      void handleFilesSelected(event.target.files);
      event.target.value = '';
    }
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canAct) return;
    event.preventDefault();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!canAct) return;
    event.preventDefault();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      void handleFilesSelected(event.dataTransfer.files);
    }
  };

  const shown = files.slice(0, VISIBLE_FILES);
  const extra = files.length - shown.length;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.filesCell}
        aria-label={files.length > 0 ? `${column.title} (${files.length})` : `Add ${column.title}`}
        onClick={(e) => {
          e.stopPropagation();
          if (open) closePopover();
          else openPopover(e.currentTarget);
        }}
      >
        {files.length === 0 ? (
          <span className={styles.hint}>
            <FileIcon aria-hidden="true" />
          </span>
        ) : (
          <>
            {shown.map((file) => (
              <span key={file.id} className={styles.fileBadge} title={file.name}>
                <FileIcon aria-hidden="true" />
                <span className={styles.text}>{file.name}</span>
              </span>
            ))}
            {extra > 0 ? <span className={styles.more}>+{extra}</span> : null}
          </>
        )}
      </button>

      {open ? (
        <AnchoredPopup anchor={anchor} onClose={closePopover} label={column.title}>
          <div className={popups.body} onDragOver={onDragOver} onDrop={onDrop}>
            {files.length === 0 ? (
              <p className={popups.muted}>No files attached</p>
            ) : (
              <div className={popups.list} role="list" aria-label={column.title}>
                {files.map((file) => {
                  const isConfirming = confirmDeleteId === file.id;
                  return (
                    <div key={file.id} role="listitem" className={popups.labelRow}>
                      <div className={popups.field} style={{ flex: 1, minWidth: 0 }}>
                        <span className={styles.text} title={file.name}>
                          {file.name}
                        </span>
                        <span className={popups.fieldLabel}>
                          {formatFileSize(file.size)} ·{' '}
                          {lookup(file.uploadedBy)?.name ?? UNKNOWN_MEMBER_NAME} ·{' '}
                          {formatUploadDate(file.uploadedAt)}
                        </span>
                      </div>
                      {isConfirming ? (
                        <div className={popups.footer}>
                          <button
                            type="button"
                            className={popups.linkButton}
                            onClick={() => void handleDelete(file)}
                          >
                            Confirm delete
                          </button>
                          <button
                            type="button"
                            className={popups.linkButton}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className={popups.footer}>
                          <button
                            type="button"
                            className={popups.iconButton}
                            aria-label={`Download ${file.name}`}
                            title="Download"
                            onClick={() => void handleDownload(file)}
                          >
                            <Download aria-hidden="true" />
                          </button>
                          {canAct ? (
                            <button
                              type="button"
                              className={popups.iconButton}
                              aria-label={`Delete ${file.name}`}
                              title="Delete"
                              onClick={() => setConfirmDeleteId(file.id)}
                            >
                              <Delete aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {uploadProgress !== null ? (
              <div className={popups.field}>
                {uploadingName ? (
                  <span className={popups.fieldLabel}>Uploading {uploadingName}…</span>
                ) : null}
                <div
                  role="progressbar"
                  aria-label="Upload progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadProgress}
                  className={styles.progressBar}
                >
                  <div className={styles.progressFill} style={{ width: `${uploadProgress}%` }} />
                  <span className={styles.progressText}>{uploadProgress}%</span>
                </div>
              </div>
            ) : null}

            {canAct ? (
              <div className={popups.footer}>
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  data-testid="files-upload-input"
                  accept={settings.allowedTypes?.join(',')}
                  onChange={onFileInputChange}
                />
                <Button
                  kind="secondary"
                  size="small"
                  leftIcon={Add}
                  disabled={uploadProgress !== null}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Add file
                </Button>
              </div>
            ) : null}
          </div>
        </AnchoredPopup>
      ) : null}
    </div>
  );
}

export const filesUi = defineColumnUi<FilesValue, FilesSettings>({
  type: 'files',
  icon: FileIcon,
  tone: 'blue',
  editor: 'none',
  Cell: FilesCell,
});
