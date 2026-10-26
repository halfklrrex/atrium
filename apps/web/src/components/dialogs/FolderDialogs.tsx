import { folderInputSchema } from '@atrium/shared';
import {
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TextField,
} from '@vibe/core';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { useBoards, useFolders, useWorkspace, type FolderDoc } from '../../data';
import { writes } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { DEFAULT_FOLDER_COLOR } from '../../theme/palette';
import { describeError, folderActions } from '../boards/board-actions';
import { showToast } from '../toast-store';
import { ColorSwatches } from './ColorSwatches';
import styles from './dialogs.module.css';
import { submitOnEnter } from './submitOnEnter';

/** Folder name and colour: creates folders and sub-folders, and renames/recolours existing ones. */
export function FolderDialog({
  workspaceId,
  folderId,
  parentFolderId = null,
  onClose,
}: {
  workspaceId: string;
  folderId?: string;
  parentFolderId?: string | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { data: folders } = useFolders(workspaceId);
  const existing = folderId ? folders.find((f) => f.id === folderId) : undefined;
  if (folderId && !existing) return null;
  const parent = existing ? existing.parentFolderId : parentFolderId;
  return (
    <FolderForm
      uid={user?.uid ?? ''}
      workspaceId={workspaceId}
      existing={existing}
      parentFolderId={parent}
      siblings={folders.filter((f) => f.parentFolderId === parent)}
      onClose={onClose}
    />
  );
}

function FolderForm({
  uid,
  workspaceId,
  existing,
  parentFolderId,
  siblings,
  onClose,
}: {
  uid: string;
  workspaceId: string;
  existing: FolderDoc | undefined;
  parentFolderId: string | null;
  siblings: readonly FolderDoc[];
  onClose: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? DEFAULT_FOLDER_COLOR);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = folderInputSchema.safeParse({ name, color, parentFolderId });

  async function submit() {
    if (!parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (existing) {
        await writes.updateFolder(workspaceId, existing.id, {
          name: parsed.data.name,
          color: parsed.data.color,
        });
      } else {
        await writes.createFolder(uid, workspaceId, parsed.data, positionAfterAll(siblings));
      }
      onClose();
    } catch (e) {
      setError(describeError(e, 'Could not save the folder.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="folder-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader
          title={existing ? 'Edit folder' : parentFolderId ? 'New sub-folder' : 'New folder'}
        />
        <ModalContent>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              title="Folder name"
              inputAriaLabel="Folder name"
              onKeyDown={submitOnEnter(() => void submit())}
              value={name}
              onChange={(value: string) => setName(value)}
              placeholder="e.g. Q4 planning"
              maxLength={80}
              autoFocus
              size="medium"
            />
            <div>
              <span className={styles.fieldLabel}>Color</span>
              <ColorSwatches label="Folder color" value={color} onChange={setColor} />
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: existing ? 'Save' : 'Create folder',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}

/** Confirm deleting a folder; its boards move to the workspace root first. */
export function DeleteFolderDialog({
  workspaceId,
  folderId,
  onClose,
}: {
  workspaceId: string;
  folderId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: folders } = useFolders(workspaceId);
  const { data: boards } = useBoards(workspaceId, uid);
  const [submitting, setSubmitting] = useState(false);

  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return null;

  async function confirm() {
    if (!folder) return;
    setSubmitting(true);
    const ok = await folderActions.remove({
      uid,
      workspaceRole: workspace?.roles[uid],
      workspaceId,
      folder,
      folders,
      boards,
    });
    if (ok) {
      showToast(`Folder "${folder.name}" was deleted.`);
      onClose();
    } else {
      setSubmitting(false);
    }
  }

  return (
    <Modal id="delete-folder-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={`Delete "${folder.name}"?`} />
        <ModalContent>
          <p className={styles.confirmText}>Boards inside will move to the workspace root.</p>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Delete folder',
          onClick: () => void confirm(),
          disabled: submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
