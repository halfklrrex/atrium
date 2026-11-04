import { saveTemplateInputSchema, TEMPLATE_LIMITS } from '@atrium/shared';
import {
  Checkbox,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TextField,
} from '@vibe/core';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { useBoard, writes } from '../../data';
import { describeError } from '../boards/board-actions';
import dialogStyles from '../dialogs/dialogs.module.css';
import { submitOnEnter } from '../dialogs/submitOnEnter';
import { showToast } from '../toast-store';

/** "Save as template" for a board: name, description and whether its items come along. */
export function SaveAsTemplateDialog({
  boardId,
  onClose,
}: {
  boardId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { data: board } = useBoard(boardId);
  if (!board || !user) return null;
  return <SaveForm board={board} uid={user.uid} onClose={onClose} />;
}

function SaveForm({
  board,
  uid,
  onClose,
}: {
  board: NonNullable<ReturnType<typeof useBoard>['data']>;
  uid: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(board.name.slice(0, TEMPLATE_LIMITS.name));
  const [description, setDescription] = useState('');
  const [includeItems, setIncludeItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = saveTemplateInputSchema.safeParse({ name, description, includeItems });

  async function submit() {
    if (!parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await writes.saveBoardAsTemplate(uid, board, parsed.data);
      showToast(`Saved the template "${parsed.data.name}".`, { type: 'positive' });
      onClose();
    } catch (e) {
      // The data layer throws plain Errors with a readable message for "too large".
      const message = e instanceof Error && !('code' in e) ? e.message : undefined;
      setError(message ?? describeError(e, 'Could not save the template.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="save-template-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Save as template" />
        <ModalContent>
          <form
            className={dialogStyles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              id="save-template-name"
              title="Template name"
              inputAriaLabel="Template name"
              value={name}
              onChange={(value: string) => setName(value)}
              onKeyDown={submitOnEnter(() => void submit())}
              maxLength={TEMPLATE_LIMITS.name}
              autoFocus
              size="medium"
            />
            <TextField
              id="save-template-description"
              title="Description"
              inputAriaLabel="Description"
              value={description}
              onChange={(value: string) => setDescription(value)}
              onKeyDown={submitOnEnter(() => void submit())}
              placeholder="What is this template for?"
              maxLength={TEMPLATE_LIMITS.description}
              size="medium"
            />
            <div>
              <Checkbox
                label="Include items"
                checked={includeItems}
                onChange={(event) => setIncludeItems(event.target.checked)}
              />
              <p className={dialogStyles.hint}>
                Adds up to {TEMPLATE_LIMITS.sampleItems} items as samples. Subitems are left out.
              </p>
            </div>
            {error ? (
              <p className={dialogStyles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Save template',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
