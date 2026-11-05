import { createBoardInputSchema, type BoardKind } from '@atrium/shared';
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
import { useBoards, writes } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { TemplateGallery } from '../templates/TemplateGallery';
import type { TemplateChoice } from '../templates/template-choice';
import { describeError } from '../boards/board-actions';
import { BOARD_KIND_OPTIONS } from '../boards/kinds';
import styles from './dialogs.module.css';
import { submitOnEnter } from './submitOnEnter';

export function KindOptions({
  value,
  onChange,
  name,
  label = 'Board type',
}: {
  value: BoardKind;
  onChange: (kind: BoardKind) => void;
  name: string;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={`${name}-label`}>
      <span id={`${name}-label`} className={styles.fieldLabel}>
        {label}
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
  const [startFrom, setStartFrom] = useState<'blank' | 'template'>('blank');
  const [template, setTemplate] = useState<TemplateChoice | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [includeSampleItems, setIncludeSampleItems] = useState(true);

  const parsed = createBoardInputSchema.safeParse({ name, kind, folderId });

  async function submit() {
    if (!user || !parsed.success || submitting) return;
    if (startFrom === 'template' && !template) return;
    setSubmitting(true);
    setError(null);
    try {
      const siblings = boards.filter((b) => b.folderId === parsed.data.folderId);
      const position = positionAfterAll(siblings);
      const id =
        startFrom === 'template' && template
          ? await writes.createBoardFromTemplate(
              user.uid,
              workspaceId,
              parsed.data,
              position,
              template,
              { includeSampleItems },
            )
          : await writes.createBoard(user.uid, workspaceId, parsed.data, position);
      onClose();
      void navigate(`/boards/${id}`);
    } catch (e) {
      setError(
        describeError(
          e,
          startFrom === 'template'
            ? 'Could not create the board from the template.'
            : 'Could not create the board.',
        ),
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      id="new-board-dialog"
      show
      size={startFrom === 'template' ? 'medium' : 'small'}
      onClose={onClose}
    >
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
              onChange={(value: string) => {
                setName(value);
                setNameTouched(true);
              }}
              placeholder="e.g. Roadmap, Home projects"
              maxLength={120}
              autoFocus
              size="medium"
            />
            <KindOptions value={kind} onChange={setKind} name="new-board-kind" />
            <div role="radiogroup" aria-labelledby="new-board-start-label">
              <span id="new-board-start-label" className={styles.fieldLabel}>
                Start from
              </span>
              <div className={styles.inlineOptions}>
                <RadioButton
                  name="new-board-start"
                  text="Blank board"
                  value="blank"
                  checked={startFrom === 'blank'}
                  onSelect={() => setStartFrom('blank')}
                />
                <RadioButton
                  name="new-board-start"
                  text="Template"
                  value="template"
                  checked={startFrom === 'template'}
                  onSelect={() => setStartFrom('template')}
                />
              </div>
            </div>
            {startFrom === 'template' ? (
              <TemplateGallery
                workspaceId={workspaceId}
                selectedKey={template?.key ?? null}
                onSelect={(choice) => {
                  setTemplate(choice);
                  if (choice && !nameTouched) setName(choice.name);
                }}
                includeSampleItems={includeSampleItems}
                onIncludeSampleItemsChange={setIncludeSampleItems}
              />
            ) : null}
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
          disabled: !parsed.success || submitting || (startFrom === 'template' && !template),
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
