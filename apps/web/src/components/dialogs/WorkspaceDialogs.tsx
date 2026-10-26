import { createWorkspaceInputSchema, type WorkspaceKind } from '@atrium/shared';
import {
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  RadioButton,
  TextArea,
  TextField,
} from '@vibe/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useWorkspace, writes } from '../../data';
import { DEFAULT_WORKSPACE_COLOR } from '../../theme/palette';
import { describeError } from '../boards/board-actions';
import { showToast } from '../toast-store';
import { ColorSwatches } from './ColorSwatches';
import styles from './dialogs.module.css';
import { submitOnEnter } from './submitOnEnter';

const firstGlyph = (text: string): string => [...text.trim()][0]?.toUpperCase() ?? '';
const clampGlyphs = (text: string, max: number): string => [...text].slice(0, max).join('');

const KIND_OPTIONS: readonly { value: WorkspaceKind; label: string; hint: string }[] = [
  {
    value: 'open',
    label: 'Open',
    hint: 'Anyone in your account can find this workspace and join it.',
  },
  {
    value: 'closed',
    label: 'Closed',
    hint: 'Only people you invite can see this workspace and its boards.',
  },
];

/** monday's "Add workspace" dialog: name, privacy, icon and colour. */
export function NewWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string>(DEFAULT_WORKSPACE_COLOR);
  const [kind, setKind] = useState<WorkspaceKind>('open');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icon = customIcon ?? (firstGlyph(name) || 'W');
  const parsed = createWorkspaceInputSchema.safeParse({ name, icon, color, kind });

  async function submit() {
    if (!user || !parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await writes.createWorkspace(user.uid, parsed.data);
      onClose();
      void navigate(`/workspaces/${id}`);
    } catch (e) {
      setError(describeError(e, 'Could not create the workspace.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="new-workspace-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Add workspace" />
        <ModalContent>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className={styles.row}>
              <TextField
                title="Icon"
                inputAriaLabel="Icon"
                onKeyDown={submitOnEnter(() => void submit())}
                value={icon}
                onChange={(value: string) => setCustomIcon(clampGlyphs(value, 2))}
                placeholder="A"
                size="medium"
              />
              <TextField
                title="Workspace name"
                inputAriaLabel="Workspace name"
                onKeyDown={submitOnEnter(() => void submit())}
                value={name}
                onChange={(value: string) => setName(value)}
                placeholder="e.g. Marketing, Home, Side projects"
                maxLength={80}
                autoFocus
                size="medium"
              />
            </div>

            <div>
              <span id="ws-color-label" className={styles.fieldLabel}>
                Color
              </span>
              <ColorSwatches label="Workspace color" value={color} onChange={setColor} />
            </div>

            <div role="radiogroup" aria-labelledby="ws-kind-label">
              <span id="ws-kind-label" className={styles.fieldLabel}>
                Workspace type
              </span>
              <div className={styles.options}>
                {KIND_OPTIONS.map((option) => (
                  <div key={option.value}>
                    <RadioButton
                      name="workspace-kind"
                      text={option.label}
                      value={option.value}
                      checked={kind === option.value}
                      onSelect={() => setKind(option.value)}
                    />
                    <p className={styles.hint}>{option.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            {/* Enter-to-submit without a visible duplicate of the footer button. */}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Add workspace',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}

/** Workspace settings (owner/admin): name, icon, colour and description. */
export function WorkspaceSettingsDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { data: workspace } = useWorkspace(workspaceId);
  if (!workspace) return null;
  return (
    <WorkspaceSettingsForm
      workspaceId={workspaceId}
      initial={{
        name: workspace.name,
        icon: workspace.icon,
        color: workspace.color,
        description: workspace.description,
      }}
      onClose={onClose}
    />
  );
}

function WorkspaceSettingsForm({
  workspaceId,
  initial,
  onClose,
}: {
  workspaceId: string;
  initial: { name: string; icon: string; color: string; description: string };
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon);
  const [color, setColor] = useState(initial.color);
  const [description, setDescription] = useState(initial.description);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = createWorkspaceInputSchema.safeParse({ name, icon, color, description });

  async function submit() {
    if (!parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await writes.updateWorkspace(workspaceId, {
        name: parsed.data.name,
        icon: parsed.data.icon,
        color: parsed.data.color,
        description: parsed.data.description,
      });
      showToast('Workspace settings saved.', { type: 'positive' });
      onClose();
    } catch (e) {
      setError(describeError(e, 'Could not save the workspace.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="workspace-settings-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Workspace settings" />
        <ModalContent>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className={styles.row}>
              <TextField
                title="Icon"
                inputAriaLabel="Icon"
                onKeyDown={submitOnEnter(() => void submit())}
                value={icon}
                onChange={(value: string) => setIcon(clampGlyphs(value, 2))}
                size="medium"
              />
              <TextField
                title="Workspace name"
                inputAriaLabel="Workspace name"
                onKeyDown={submitOnEnter(() => void submit())}
                value={name}
                onChange={(value: string) => setName(value)}
                maxLength={80}
                autoFocus
                size="medium"
              />
            </div>
            <div>
              <span className={styles.fieldLabel}>Color</span>
              <ColorSwatches label="Workspace color" value={color} onChange={setColor} />
            </div>
            <TextArea
              label="Description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setDescription(e.target.value)
              }
              placeholder="Add workspace description"
              maxLength={500}
              rows={3}
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
          text: 'Save',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
