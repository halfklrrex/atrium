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
import { dashboardWrites, docWrites, useDashboard, useDocMeta, useWorkspace } from '../../data';
import { UNKNOWN_PERSON_NAME, useWorkspaceMembers } from '../../data/members-store';
import { describeCallableError } from '../../lib/callables';
import { defaultAddRole, isLastExplicitOwner, membersLosingAccess } from '../boards/board-sharing';
import { BOARD_KIND_OPTIONS } from '../boards/kinds';
import { AccessRow, PersonCell, type Person } from '../boards/ShareBoardDialog';
import styles from '../boards/ShareBoardDialog.module.css';
import { ROLE_LABEL } from '../membership/roles';
import { showToast } from '../toast-store';

export type ShareEntityKind = 'dashboard' | 'doc';

type SharingChange = Parameters<typeof dashboardWrites.setDashboardSharing>[1];

/**
 * The Share dialog of a dashboard or a doc: its type and the people on it with their roles. Same
 * patterns as the board dialog (and its row components), but changes go through the server (the
 * `setDashboardAccess` or `setDocAccess` callable via `dashboardWrites` / `docWrites`). The text
 * is the same for both, with the noun swapped.
 */
export function ShareEntityDialog({
  kind: entityKind,
  entityId,
  onClose,
}: {
  kind: ShareEntityKind;
  entityId: string;
  onClose: () => void;
}) {
  const noun = entityKind;
  const lastOwnerMessage = `A ${noun} needs at least one owner. Make someone else an owner first.`;
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  // Both listeners are always called (hooks can't be conditional); the other one gets no id.
  const dashboardState = useDashboard(entityKind === 'dashboard' ? entityId : undefined);
  const docState = useDocMeta(entityKind === 'doc' ? entityId : undefined);
  const entity = entityKind === 'dashboard' ? dashboardState.data : docState.data;
  const { data: workspace } = useWorkspace(entity?.workspaceId);
  const { members } = useWorkspaceMembers(entity?.workspaceId);
  const [pendingKind, setPendingKind] = useState<BoardKind | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profiles = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  if (!entity || !workspace) return null;
  const isOwner = canManageBoard(resolveBoardRole(entity, uid, workspace.roles[uid]));

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

  async function run(change: SharingChange, failure: string, success?: string) {
    setBusy(true);
    setError(null);
    try {
      if (entityKind === 'dashboard') {
        await dashboardWrites.setDashboardSharing(entityId, change);
      } else {
        await docWrites.setDocSharing(entityId, change);
      }
      if (success) showToast(success, { type: 'positive' });
      return true;
    } catch (e) {
      console.error(failure, e);
      setError(describeCallableError(e, failure));
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

  const explicit = Object.entries(entity.access)
    .map(([id, boardRole]) => ({ person: personOf(id), boardRole }))
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
  const needle = query.trim().toLowerCase();
  const candidates = workspace.memberIds
    .filter((id) => !(id in entity.access))
    .map(personOf)
    .filter(
      (p) =>
        needle !== '' &&
        (p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const losing = membersLosingAccess(entity, workspace, uid);
  const pendingLabel = BOARD_KIND_OPTIONS.find((o) => o.value === pendingKind)?.label.toLowerCase();

  return (
    <Modal id={`share-${noun}-dialog`} show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={`Share ${entity.name}`} />
        <ModalContent>
          <div className={styles.body}>
            <div role="radiogroup" aria-labelledby={`share-${noun}-kind-label`}>
              <span id={`share-${noun}-kind-label`} className={styles.sectionTitle}>
                {noun === 'doc' ? 'Doc' : 'Dashboard'} type
              </span>
              <div className={styles.kinds}>
                {BOARD_KIND_OPTIONS.map((option) => (
                  <div key={option.value}>
                    <RadioButton
                      name={`share-${noun}-kind`}
                      text={option.label}
                      value={option.value}
                      checked={(pendingKind ?? entity.kind) === option.value}
                      disabled={!isOwner || busy}
                      onSelect={() =>
                        setPendingKind(option.value === entity.kind ? null : option.value)
                      }
                    />
                    <p className={styles.hint}>{option.hint.replace(/\bboard\b/g, noun)}</p>
                  </div>
                ))}
              </div>
            </div>

            {pendingKind ? (
              <div className={styles.confirm} role="alertdialog" aria-label={`Change ${noun} type`}>
                <p className={styles.confirmText}>
                  {pendingKind === 'main'
                    ? `Everyone in the workspace will be able to open this ${noun}. People listed below keep the role they have here.`
                    : losing > 0
                      ? `${losing} workspace ${losing === 1 ? 'member' : 'members'} will lose access to this ${noun}. You stay on it as an owner.`
                      : `Only the people listed below will be able to open this ${noun}. You stay on it as an owner.`}
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
                        `Could not change the ${noun} type.`,
                        `${noun === 'doc' ? 'Doc' : 'Dashboard'} type updated.`,
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
                Only a {noun} owner can change who can open this {noun}.
              </p>
            )}

            <div>
              <span className={styles.sectionTitle}>
                {entity.kind === 'main' ? 'People with a set role' : 'People with access'}
              </span>
              {explicit.length === 0 ? (
                <p className={styles.empty}>
                  {entity.kind === 'main'
                    ? 'Nobody has a set role. Everyone follows their workspace role.'
                    : `Nobody is listed on this ${noun}.`}
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
                      lastOwner={isLastExplicitOwner(entity, person.uid)}
                      onChange={(next) => void setRole(person, next)}
                      onRemove={() =>
                        void setRole(person, null, `${person.name} was removed from the ${noun}.`)
                      }
                      onBlocked={() => setError(lastOwnerMessage)}
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
