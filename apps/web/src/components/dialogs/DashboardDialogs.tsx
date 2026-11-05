import { createDashboardInputSchema, type BoardKind } from '@atrium/shared';
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
import { dashboardWrites, useWorkspaceDashboards } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { describeError } from '../boards/board-actions';
import { KindOptions } from './BoardDialogs';
import styles from './dialogs.module.css';
import { submitOnEnter } from './submitOnEnter';

/** "New dashboard": name and type. The dashboard starts empty; boards and widgets are added on its page. */
export function NewDashboardDialog({
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
  const { data: dashboards } = useWorkspaceDashboards(workspaceId, user?.uid ?? null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BoardKind>(initialKind);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = createDashboardInputSchema.safeParse({ name, kind, folderId });

  async function submit() {
    if (!user || !parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const siblings = dashboards.filter((d) => d.folderId === parsed.data.folderId);
      const id = await dashboardWrites.createDashboard(
        user.uid,
        workspaceId,
        parsed.data,
        positionAfterAll(siblings),
      );
      onClose();
      void navigate(`/dashboards/${id}`);
    } catch (e) {
      setError(describeError(e, 'Could not create the dashboard.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="new-dashboard-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Create dashboard" />
        <ModalContent>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              title="Dashboard name"
              inputAriaLabel="Dashboard name"
              onKeyDown={submitOnEnter(() => void submit())}
              value={name}
              onChange={(value: string) => setName(value)}
              placeholder="e.g. Team overview"
              maxLength={80}
              autoFocus
              size="medium"
            />
            <KindOptions
              value={kind}
              onChange={setKind}
              name="new-dashboard-kind"
              label="Dashboard type"
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
          text: 'Create dashboard',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
