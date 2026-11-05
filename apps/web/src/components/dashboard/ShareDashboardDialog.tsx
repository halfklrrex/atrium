import { canManageBoard, resolveBoardRole, type BoardKind, type BoardRole } from '@atrium/shared';
import {
  Button,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalHeader,
  RadioButton,
  TextField,
} from '@vibe/core';
import { useMemo, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { dashboardWrites, useDashboard, useWorkspace } from '../../data';
import { UNKNOWN_PERSON_NAME, useWorkspaceMembers } from '../../data/members-store';
import { describeError } from '../boards/board-actions';
import { defaultAddRole, isLastExplicitOwner, membersLosingAccess } from '../boards/board-sharing';
import { BOARD_KIND_OPTIONS } from '../boards/kinds';
import { AccessRow, PersonCell, type Person } from '../boards/ShareBoardDialog';
import styles from '../boards/ShareBoardDialog.module.css';
import { ROLE_LABEL } from '../membership/roles';
import { showToast } from '../toast-store';

const LAST_OWNER_MESSAGE =
  'A dashboard needs at least one owner. Make someone else an owner first.';

/**
 * The Share dialog of a dashboard: its type and the people on it with their roles. Same patterns
 * as the board dialog (and its row components), but the owner writes the dashboard document
 * directly, as the rules allow (`dashboardWrites.setDashboardSharing`).
 */
export function ShareDashboardDialog({
  dashboardId,
  onClose,
}: {
  dashboardId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: dashboard } = useDashboard(dashboardId);
  const { data: workspace } = useWorkspace(dashboard?.workspaceId);
  const { members } = useWorkspaceMembers(dashboard?.workspaceId);
  const [pendingKind, setPendingKind] = useState<BoardKind | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profiles = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  if (!dashboard || !workspace) return null;
  const isOwner = canManageBoard(resolveBoardRole(dashboard, uid, workspace.roles[uid]));

  const personOf = (personUid: string): Person => {
    const profile = profiles.get(personUid);
    const self = personUid === uid ? user : null;
    const email = profile?.email || self?.email || '';
    return {
      uid: personUid,
      name: profile?.displayName || self?.displayName || email || UNKNOWN_PERSON_NAME,
      email,
      photoURL: profile?.photoURL ?? self?.photoURL ?? null,
      workspaceRole: workspace.roles[personUid] ?? null,
    };
  };

  async function run(
    change: Parameters<typeof dashboardWrites.setDashboardSharing>[1],
    failure: string,
    success?: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      await dashboardWrites.setDashboardSharing(dashboardId, change);
      if (success) showToast(success, { type: 'positive' });
      return true;
    } catch (e) {
      console.error(failure, e);
      setError(describeError(e, failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const setRole = (person: Person, role: BoardRole | null, success?: string) =>
    run(
      { person: { uid: person.uid, role } },
      role ? 'Could not change that role.' : 'Could not remove that person.',
      success,
    );

  const explicit = Object.entries(dashboard.access)
    .map(([id, boardRole]) => ({ person: personOf(id), boardRole }))
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
  const needle = query.trim().toLowerCase();
  const candidates = workspace.memberIds
    .filter((id) => !(id in dashboard.access))
    .map(personOf)
    .filter(
      (p) =>
        needle !== '' &&
        (p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const losing = membersLosingAccess(dashboard, workspace, uid);
  const pendingLabel = BOARD_KIND_OPTIONS.find((o) => o.value === pendingKind)?.label.toLowerCase();

  return (
    <Modal id="share-dashboard-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={`Share ${dashboard.name}`} />
        <ModalContent>
          <div className={styles.body}>
            <div role="radiogroup" aria-labelledby="share-dashboard-kind-label">
              <span id="share-dashboard-kind-label" className={styles.sectionTitle}>
                Dashboard type
              </span>
              <div className={styles.kinds}>
                {BOARD_KIND_OPTIONS.map((option) => (
                  <div key={option.value}>
                    <RadioButton
                      name="share-dashboard-kind"
                      text={option.label}
                      value={option.value}
                      checked={(pendingKind ?? dashboard.kind) === option.value}
                      disabled={!isOwner || busy}
                      onSelect={() =>
                        setPendingKind(option.value === dashboard.kind ? null : option.value)
                      }
                    />
                    <p className={styles.hint}>{option.hint.replace(/\bboard\b/g, 'dashboard')}</p>
                  </div>
                ))}
              </div>
            </div>

            {pendingKind ? (
              <div className={styles.confirm} role="alertdialog" aria-label="Change dashboard type">
                <p className={styles.confirmText}>
                  {pendingKind === 'main'
                    ? 'Everyone in the workspace will be able to open this dashboard. People listed below keep the role they have here.'
                    : losing > 0
                      ? `${losing} workspace ${losing === 1 ? 'member' : 'members'} will lose access to this dashboard. You stay on it as an owner.`
                      : 'Only the people listed below will be able to open this dashboard. You stay on it as an owner.'}
                </p>
                <div className={styles.confirmActions}>
                  <Button
                    kind="primary"
                    size="small"
                    color={pendingKind !== 'main' && losing > 0 ? 'negative' : 'primary'}
                    loading={busy}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        { kind: pendingKind },
                        'Could not change the dashboard type.',
                        'Dashboard type updated.',
                      ).then((ok) => ok && setPendingKind(null))
                    }
                  >
                    {`Make ${pendingLabel}`}
                  </Button>
                  <Button
                    kind="tertiary"
                    size="small"
                    disabled={busy}
                    onClick={() => setPendingKind(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {isOwner ? (
              <div>
                <TextField
                  title="Add people"
                  inputAriaLabel="Add people"
                  placeholder="Search workspace members by name or email"
                  value={query}
                  onChange={(value: string) => setQuery(value)}
                  size="medium"
                />
                {needle !== '' ? (
                  candidates.length > 0 ? (
                    <ul className={styles.list} aria-label="Matching workspace members">
                      {candidates.map((person) => (
                        <li key={person.uid} className={styles.row}>
                          <PersonCell person={person} />
                          <span className={styles.workspaceRole}>
                            {person.workspaceRole ? ROLE_LABEL[person.workspaceRole] : ''}
                          </span>
                          <span />
                          <Button
                            kind="secondary"
                            size="small"
                            disabled={busy}
                            aria-label={`Add ${person.name}`}
                            onClick={() =>
                              void setRole(person, defaultAddRole(person.workspaceRole)).then(
                                (ok) => ok && setQuery(''),
                              )
                            }
                          >
                            Add
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.empty}>
                      No workspace members match. Only people in this workspace can be added.
                    </p>
                  )
                ) : null}
              </div>
            ) : (
              <p className={styles.hint}>
                Only a dashboard owner can change who can open this dashboard.
              </p>
            )}

            <div>
              <span className={styles.sectionTitle}>
                {dashboard.kind === 'main' ? 'People with a set role' : 'People with access'}
              </span>
              {explicit.length === 0 ? (
                <p className={styles.empty}>
                  {dashboard.kind === 'main'
                    ? 'Nobody has a set role. Everyone follows their workspace role.'
                    : 'Nobody is listed on this dashboard.'}
                </p>
              ) : (
                <ul className={styles.list} aria-label="People with access">
                  {explicit.map(({ person, boardRole }) => (
                    <AccessRow
                      key={person.uid}
                      person={person}
                      boardRole={boardRole}
                      isSelf={person.uid === uid}
                      canEdit={isOwner}
                      busy={busy}
                      lastOwner={isLastExplicitOwner(dashboard, person.uid)}
                      onChange={(next) => void setRole(person, next)}
                      onRemove={() =>
                        void setRole(person, null, `${person.name} was removed from the dashboard.`)
                      }
                      onBlocked={() => setError(LAST_OWNER_MESSAGE)}
                    />
                  ))}
                </ul>
              )}
            </div>

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}
