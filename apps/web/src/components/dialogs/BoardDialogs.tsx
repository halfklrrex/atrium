import {
  canManageBoard,
  createBoardInputSchema,
  resolveBoardRole,
  type BoardKind,
} from '@atrium/shared';
import {
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  RadioButton,
  TextField,
} from '@vibe/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useBoard, useBoards, useWorkspace, writes } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { describeError } from '../boards/board-actions';
import { BOARD_KIND_OPTIONS } from '../boards/kinds';
import { showToast } from '../toast-store';
import styles from './dialogs.module.css';
import { submitOnEnter } from './submitOnEnter';

function KindOptions({
  value,
  onChange,
  name,
}: {
  value: BoardKind;
  onChange: (kind: BoardKind) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={`${name}-label`}>
      <span id={`${name}-label`} className={styles.fieldLabel}>
        Board type
      </span>
      <div className={styles.options}>
        {BOARD_KIND_OPTIONS.map((option) => (
          <div key={option.value}>
            <RadioButton
              name={name}
              text={option.label}
              value={option.value}
              checked={value === option.value}
              onSelect={() => onChange(option.value)}
            />
            <p className={styles.hint}>{option.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "New board": name and type; the board starts with monday's default columns and groups. */
export function NewBoardDialog({
  workspaceId,
  folderId,
  initialKind = 'main',
  onClose,
}: {
  workspaceId: string;
  folderId: string | null;
  initialKind?: BoardKind;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: boards } = useBoards(workspaceId, user?.uid ?? null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BoardKind>(initialKind);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = createBoardInputSchema.safeParse({ name, kind, folderId });

  async function submit() {
    if (!user || !parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const siblings = boards.filter((b) => b.folderId === parsed.data.folderId);
      const id = await writes.createBoard(
        user.uid,
        workspaceId,
        parsed.data,
        positionAfterAll(siblings),
      );
      onClose();
      void navigate(`/boards/${id}`);
    } catch (e) {
      setError(describeError(e, 'Could not create the board.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="new-board-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Create board" />
        <ModalContent>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              title="Board name"
              inputAriaLabel="Board name"
              onKeyDown={submitOnEnter(() => void submit())}
              value={name}
              onChange={(value: string) => setName(value)}
              placeholder="e.g. Roadmap, Home projects"
              maxLength={120}
              autoFocus
              size="medium"
            />
            <KindOptions value={kind} onChange={setKind} name="new-board-kind" />
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
          text: 'Create board',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}

/** "Board permissions": switch between Main, Private and Shareable (board owners only). */
export function BoardPermissionsDialog({
  boardId,
  onClose,
}: {
  boardId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { data: board } = useBoard(boardId);
  const { data: workspace } = useWorkspace(board?.workspaceId);
  const [selected, setSelected] = useState<BoardKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!board) return null;
  const kind = selected ?? board.kind;
  const role = resolveBoardRole(board, user?.uid ?? '', workspace?.roles[user?.uid ?? '']);
  const isOwner = canManageBoard(role);

  async function submit() {
    if (!board || !isOwner || kind === board.kind) return onClose();
    setSubmitting(true);
    setError(null);
    try {
      await writes.updateBoard(board.id, { kind });
      showToast('Board permissions updated.', { type: 'positive' });
      onClose();
    } catch (e) {
      setError(describeError(e, 'Could not change the board type.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="board-permissions-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Board permissions" />
        <ModalContent>
          <div className={styles.form}>
            <p className={styles.confirmText}>{board.name}</p>
            <KindOptions value={kind} onChange={setSelected} name="board-kind" />
            {!isOwner ? (
              <p className={styles.hint}>Only the board owner can change who can see this board.</p>
            ) : null}
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Save',
          onClick: () => void submit(),
          disabled: !isOwner || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
