import { DASHBOARD_LIMITS } from '@atrium/shared';
import {
  Checkbox,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@vibe/core';
import { useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { dashboardWrites, useBoards, useDashboard } from '../../data';
import { activeBoards } from '../../data/boards';
import { describeError } from '../boards/board-actions';
import dialogStyles from '../dialogs/dialogs.module.css';
import styles from './dashboard.module.css';

/** Chooses the boards a dashboard reads from (at most 50). Widgets then read some or all of them. */
export function DashboardBoardsDialog({
  dashboardId,
  onClose,
}: {
  dashboardId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { data: dashboard } = useDashboard(dashboardId);
  const { data: boards } = useBoards(dashboard?.workspaceId, user?.uid ?? null);
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = activeBoards(boards);
  const selected = chosen ?? new Set(dashboard?.boardIds ?? []);
  const tooMany = selected.size > DASHBOARD_LIMITS.boards;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setChosen(next);
  };

  async function save() {
    if (saving || tooMany) return;
    setSaving(true);
    setError(null);
    try {
      // Boards the user cannot list stay on the dashboard; the checked, listed ones are added.
      const listed = new Set(available.map((b) => b.id));
      const kept = (dashboard?.boardIds ?? []).filter((id) => !listed.has(id));
      const checked = [...selected].filter((id) => listed.has(id));
      await dashboardWrites.setDashboardBoards(dashboardId, [...kept, ...checked]);
      onClose();
    } catch (e) {
      setError(describeError(e, 'Could not save the boards.'));
      setSaving(false);
    }
  }

  return (
    <Modal id="dashboard-boards-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Dashboard boards" />
        <ModalContent>
          <div className={dialogStyles.form}>
            <p className={dialogStyles.hint}>
              Widgets read live data from these boards. You only see data from boards you can open.
            </p>
            {available.length === 0 ? (
              <p className={dialogStyles.hint}>This workspace has no boards yet.</p>
            ) : (
              <ul className={styles.checkList} aria-label="Boards">
                {available.map((board) => (
                  <li key={board.id}>
                    <Checkbox
                      label={board.name}
                      checked={selected.has(board.id)}
                      onChange={() => toggle(board.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {tooMany ? (
              <p className={dialogStyles.error} role="alert">
                A dashboard can read at most {DASHBOARD_LIMITS.boards} boards.
              </p>
            ) : null}
            {error ? (
              <p className={dialogStyles.error} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: 'Save',
          onClick: () => void save(),
          disabled: saving || tooMany || !dashboard,
          loading: saving,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: saving }}
      />
    </Modal>
  );
}
