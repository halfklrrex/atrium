import { createDocInputSchema, type BoardKind } from '@atrium/shared';
import {
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TextField,
} from '@vibe/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { docWrites, useWorkspaceDocs } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { docPath } from '../../lib/paths';
import { describeError } from '../boards/board-actions';
import { KindOptions } from './BoardDialogs';
import styles from './dialogs.module.css';
import { submitOnEnter } from './submitOnEnter';

const DOC_KIND_OPTIONS: readonly { value: BoardKind; label: string; hint: string }[] = [
  {
    value: 'main',
    label: 'Main',
    hint: 'Visible to everyone in the workspace. Members can edit it.',
  },
  {
    value: 'private',
    label: 'Private',
    hint: 'Only you can find and open this doc until you share it.',
  },
];

export const DEFAULT_DOC_NAME = 'New doc';

/** "New doc": name and type. The doc opens right away with its title ready to edit. */
export function NewDocDialog({
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
  const { data: docs } = useWorkspaceDocs(workspaceId, user?.uid ?? null);
  const [name, setName] = useState(DEFAULT_DOC_NAME);
  const [kind, setKind] = useState<BoardKind>(initialKind);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = createDocInputSchema.safeParse({ name, kind, folderId });

  async function submit() {
    if (!user || !parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const siblings = docs.filter((d) => d.folderId === parsed.data.folderId);
      const id = await docWrites.createDoc(
        user.uid,
        workspaceId,
        parsed.data,
        positionAfterAll(siblings),
      );
      onClose();
      void navigate(docPath({ id, name: parsed.data.name }), { state: { focusTitle: true } });
    } catch (e) {
      setError(describeError(e, 'Could not create the doc.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="new-doc-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Create doc" />
        <ModalContent>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              title="Doc name"
              inputAriaLabel="Doc name"
              onKeyDown={submitOnEnter(() => void submit())}
              value={name}
              onChange={(value: string) => setName(value)}
              placeholder="e.g. Summer trip packing list"
              maxLength={80}
              autoFocus
              size="medium"
            />
            <KindOptions
              value={kind}
              onChange={setKind}
              name="new-doc-kind"
              label="Doc type"
              options={DOC_KIND_OPTIONS}
            />
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
          text: 'Create doc',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
