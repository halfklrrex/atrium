import {
  BOARD_ROLES,
  canManageBoard,
  canManageWorkspace,
  resolveBoardRole,
  type BoardKind,
  type BoardRole,
  type WorkspaceRole,
} from '@atrium/shared';
import {
  Button,
  Dropdown,
  IconButton,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalHeader,
  RadioButton,
  TextField,
  Tooltip,
} from '@vibe/core';
import { Close } from '@vibe/icons';
import { useMemo, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { useBoard, useWorkspace } from '../../data';
import { UNKNOWN_PERSON_NAME, useWorkspaceMembers } from '../../data/members-store';
import { boardSharingCalls, describeCallableError } from '../../lib/callables';
import { useUiStore } from '../AppShell/ui-store';
import { ROLE_LABEL } from '../membership/roles';
import { showToast } from '../toast-store';
import { UserAvatar } from '../UserAvatar';
import {
  BOARD_ROLE_LABEL,
  allowedBoardRoles,
  capExplanation,
  defaultAddRole,
  isLastExplicitOwner,
  membersLosingAccess,
} from './board-sharing';
import styles from './ShareBoardDialog.module.css';
import { BOARD_KIND_OPTIONS } from './kinds';

interface Person {
  uid: string;
  name: string;
  email: string;
  photoURL: string | null;
  workspaceRole: WorkspaceRole | null;
}

type DropdownOption = { value: string; label: string };

const toOption = (selected: unknown): DropdownOption | null => {
  if (!selected) return null;
  return (Array.isArray(selected) ? selected[0] : selected) as DropdownOption | null;
};

const LAST_OWNER_MESSAGE = 'A board needs at least one owner. Make someone else an owner first.';

/** monday's "Invite" dialog for a board: its type, the people on it and their board roles. */
export function ShareBoardDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const openDialog = useUiStore((s) => s.openDialog);
  const { data: board } = useBoard(boardId);
  const { data: workspace } = useWorkspace(board?.workspaceId);
  const { members } = useWorkspaceMembers(board?.workspaceId);
  const [pendingKind, setPendingKind] = useState<BoardKind | null>(null);
  const [query, setQuery] = useState('');
  const [showImplicit, setShowImplicit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profiles = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  if (!board || !workspace) return null;
  const role = resolveBoardRole(board, uid, workspace.roles[uid]);
  const isOwner = canManageBoard(role);
  const isWorkspaceAdmin = canManageWorkspace(workspace.roles[uid]);

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

  async function run(task: () => Promise<unknown>, failure: string, success?: string) {
    setBusy(true);
    setError(null);
    try {
      await task();
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

  const setAccess = (person: Person, next: BoardRole | null, success?: string) =>
    run(
      () => boardSharingCalls.setAccess({ boardId, uid: person.uid, role: next }),
      next ? 'Could not change that role.' : 'Could not remove that person.',
      success,
    );

  async function applyKind() {
    if (!pendingKind) return;
    const ok = await run(
      () => boardSharingCalls.setKind({ boardId, kind: pendingKind }),
      'Could not change the board type.',
      'Board type updated.',
    );
    if (ok) setPendingKind(null);
  }

  const explicit = Object.entries(board.access)
    .map(([id, boardRole]) => ({ person: personOf(id), boardRole }))
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
  const implicit =
    board.kind === 'main'
      ? workspace.memberIds.filter((id) => !(id in board.access)).map(personOf)
      : [];
  const needle = query.trim().toLowerCase();
  const candidates = workspace.memberIds
    .filter((id) => !(id in board.access))
    .map(personOf)
    .filter(
      (p) =>
        needle !== '' &&
        (p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const losing = membersLosingAccess(board, workspace, uid);
  const pendingLabel = BOARD_KIND_OPTIONS.find((o) => o.value === pendingKind)?.label.toLowerCase();

  return (
    <Modal id="share-board-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={`Share ${board.name}`} />
        <ModalContent>
          <div className={styles.body}>
            <div role="radiogroup" aria-labelledby="share-board-kind-label">
              <span id="share-board-kind-label" className={styles.sectionTitle}>
                Board type
              </span>
              <div className={styles.kinds}>
                {BOARD_KIND_OPTIONS.map((option) => (
                  <div key={option.value}>
                    <RadioButton
                      name="share-board-kind"
                      text={option.label}
                      value={option.value}
                      checked={(pendingKind ?? board.kind) === option.value}
                      disabled={!isOwner || busy}
                      onSelect={() =>
                        setPendingKind(option.value === board.kind ? null : option.value)
                      }
                    />
                    <p className={styles.hint}>{option.hint}</p>
                  </div>
                ))}
              </div>
            </div>

            {pendingKind ? (
              <div className={styles.confirm} role="alertdialog" aria-label="Change board type">
                <p className={styles.confirmText}>
                  {pendingKind === 'main'
                    ? 'Everyone in the workspace will be able to open this board, with a role based on their workspace role. People listed below keep the role they have here, so a Viewer entry still restricts a member to reading.'
                    : losing > 0
                      ? `${losing} workspace ${losing === 1 ? 'member' : 'members'} will lose access to this board. You stay on it as an owner; add the others again below if they should keep access.`
                      : 'Only the people listed below will be able to open this board. You stay on it as an owner.'}
                </p>
                <div className={styles.confirmActions}>
                  <Button
                    kind="primary"
                    size="small"
                    color={pendingKind !== 'main' && losing > 0 ? 'negative' : 'primary'}
                    loading={busy}
                    disabled={busy}
                    onClick={() => void applyKind()}
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
                              void setAccess(person, defaultAddRole(person.workspaceRole)).then(
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
                {isWorkspaceAdmin ? (
                  <Button
                    kind="tertiary"
                    size="small"
                    onClick={() => openDialog({ type: 'members', workspaceId: board.workspaceId })}
                  >
                    Invite someone new to the workspace
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className={styles.hint}>Only a board owner can change who can open this board.</p>
            )}

            <div>
              <span className={styles.sectionTitle}>
                {board.kind === 'main' ? 'People with a set role' : 'People with access'}
              </span>
              {explicit.length === 0 ? (
                <p className={styles.empty}>
                  {board.kind === 'main'
                    ? 'Nobody has a set role. Everyone follows their workspace role.'
                    : 'Nobody is listed on this board.'}
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
                      lastOwner={isLastExplicitOwner(board, person.uid)}
                      onChange={(next) => void setAccess(person, next)}
                      onRemove={() =>
                        void setAccess(person, null, `${person.name} was removed from the board.`)
                      }
                      onBlocked={() => setError(LAST_OWNER_MESSAGE)}
                    />
                  ))}
                </ul>
              )}
              {board.kind === 'main' && implicit.length > 0 ? (
                <div>
                  <Button
                    kind="tertiary"
                    size="small"
                    aria-expanded={showImplicit}
                    onClick={() => setShowImplicit((v) => !v)}
                  >
                    {`${implicit.length} workspace ${implicit.length === 1 ? 'member' : 'members'}`}
                  </Button>
                  {showImplicit ? (
                    <ul className={styles.list} aria-label="Workspace members">
                      {implicit.map((person) => (
                        <li key={person.uid} className={styles.row}>
                          <PersonCell person={person} />
                          <span className={styles.workspaceRole}>
                            {person.workspaceRole ? ROLE_LABEL[person.workspaceRole] : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
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

function PersonCell({ person, isSelf }: { person: Person; isSelf?: boolean }) {
  return (
    <div className={styles.person}>
      <UserAvatar uid={person.uid} name={person.name} photoURL={person.photoURL} size="medium" />
      <div className={styles.names}>
        <span className={styles.name}>
          {person.name}
          {isSelf ? ' (you)' : ''}
        </span>
        {person.email ? <span className={styles.email}>{person.email}</span> : null}
      </div>
    </div>
  );
}

function AccessRow({
  person,
  boardRole,
  isSelf,
  canEdit,
  busy,
  lastOwner,
  onChange,
  onRemove,
  onBlocked,
}: {
  person: Person;
  boardRole: BoardRole;
  isSelf: boolean;
  canEdit: boolean;
  busy: boolean;
  lastOwner: boolean;
  onChange: (role: BoardRole) => void;
  onRemove: () => void;
  onBlocked: () => void;
}) {
  const allowed = allowedBoardRoles(person.workspaceRole);
  // Options above the workspace cap are not offered; a tooltip explains why.
  const options: DropdownOption[] = BOARD_ROLES.filter(
    (r) => allowed.includes(r) || r === boardRole,
  ).map((r) => ({ value: r, label: BOARD_ROLE_LABEL[r] }));
  const capped = capExplanation(person.workspaceRole);
  const control = canEdit ? (
    <Dropdown
      size="small"
      clearable={false}
      searchable={false}
      disabled={busy}
      aria-label={`Board role for ${person.name}`}
      options={options}
      value={options.find((o) => o.value === boardRole)}
      onChange={(selected: unknown) => {
        const option = toOption(selected);
        if (!option || option.value === boardRole) return;
        if (lastOwner) return onBlocked();
        onChange(option.value as BoardRole);
      }}
    />
  ) : (
    <span className={styles.roleStatic}>{BOARD_ROLE_LABEL[boardRole]}</span>
  );
  return (
    <li className={styles.row}>
      <PersonCell person={person} isSelf={isSelf} />
      <span className={styles.workspaceRole}>
        {person.workspaceRole ? ROLE_LABEL[person.workspaceRole] : 'Left the workspace'}
      </span>
      <div className={styles.roleControl}>
        {capped && canEdit ? <Tooltip content={capped}>{control}</Tooltip> : control}
      </div>
      {canEdit ? (
        <IconButton
          icon={Close}
          size="small"
          kind="tertiary"
          disabled={busy}
          aria-label={`Remove ${person.name}`}
          onClick={() => (lastOwner ? onBlocked() : onRemove())}
        />
      ) : (
        <span />
      )}
    </li>
  );
}
