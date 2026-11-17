import {
  TEAM_LIMITS,
  canManageWorkspace,
  inviteEmailSchema,
  invitableRoles,
  type InviteRole,
  type WorkspaceRole,
} from '@atrium/shared';
import {
  AvatarGroup,
  Button,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalHeader,
  Tab,
  TabList,
  TextField,
} from '@vibe/core';
import { Delete, Edit, Invite, Person, Team } from '@vibe/icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useWorkspace, useWorkspaceInvites, useWorkspaceMembers, type TeamDoc } from '../../data';
import { teamWrites, useWorkspaceTeams } from '../../data/teams';
import { describeCallableError, membershipCalls } from '../../lib/callables';
import { showToast } from '../toast-store';
import { TeamAvatar } from '../teams/TeamAvatar';
import { TeamDialog } from '../teams/TeamDialog';
import teamStyles from '../teams/teams.module.css';
import { PopupLayer } from '../PopupLayer';
import { ProfileLink } from '../profile';
import { UserAvatar } from '../UserAvatar';
import styles from './MembersDialog.module.css';
import { memberRowActions } from './permissions';
import { ROLE_LABEL, describeExpiry, inviteLink } from './roles';

type DialogTab = 'members' | 'invites' | 'teams';

interface Row {
  uid: string;
  role: WorkspaceRole;
  name: string;
  email: string;
  photoURL: string | null;
}

type Confirm =
  | { kind: 'remove'; uid: string; name: string }
  | { kind: 'transfer'; uid: string; name: string }
  | { kind: 'leave' }
  | { kind: 'deleteTeam'; teamId: string; name: string };

type DropdownOption = { value: string; label: string };

const toOption = (selected: unknown): DropdownOption | null => {
  if (!selected) return null;
  return (Array.isArray(selected) ? selected[0] : selected) as DropdownOption | null;
};

const roleOptions = (roles: readonly WorkspaceRole[]): DropdownOption[] =>
  roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

/** Workspace members and invitations (monday's "Members" dialog): roles, transfer, remove, leave. */
export function MembersDialog({
  workspaceId,
  initialTab,
  onClose,
}: {
  workspaceId: string;
  initialTab?: DialogTab;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace(workspaceId);
  const { members } = useWorkspaceMembers(workspaceId);
  const uid = user?.uid ?? '';
  const myRole = workspace?.roles[uid] ?? null;
  const isAdmin = canManageWorkspace(myRole);
  const [tab, setTab] = useState<DialogTab>(
    initialTab === 'invites' && isAdmin ? 'invites' : initialTab === 'teams' ? 'teams' : 'members',
  );
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ team?: TeamDoc } | null>(null);
  const { teams } = useWorkspaceTeams(workspaceId);

  const rows = useMemo<Row[]>(() => {
    if (!workspace) return [];
    const profiles = new Map(members.map((m) => [m.id, m]));
    const order: Record<WorkspaceRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
    return Object.entries(workspace.roles)
      .map(([memberUid, role]): Row => {
        const profile = profiles.get(memberUid);
        const self = memberUid === uid ? user : null;
        const email = profile?.email || self?.email || '';
        return {
          uid: memberUid,
          role,
          name: profile?.displayName || self?.displayName || email || 'Member',
          email,
          photoURL: profile?.photoURL ?? self?.photoURL ?? null,
        };
      })
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  }, [workspace, members, uid, user]);

  const people = useMemo(
    () => rows.map((r) => ({ uid: r.uid, name: r.name, email: r.email, photoURL: r.photoURL })),
    [rows],
  );
  const tabs: DialogTab[] = isAdmin ? ['members', 'invites', 'teams'] : ['members', 'teams'];

  if (!workspace || !myRole) return null;

  // The team editor replaces this dialog while it is open and hands back to it on close.
  if (editor) {
    return (
      <TeamDialog
        workspaceId={workspaceId}
        team={editor.team}
        people={people}
        onClose={() => setEditor(null)}
      />
    );
  }

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

  const changeRole = (row: Row, role: WorkspaceRole) =>
    run(
      () => membershipCalls.changeMemberRole({ workspaceId, uid: row.uid, role }),
      'Could not change the role.',
      `${row.name} is now ${ROLE_LABEL[role].toLowerCase()}.`,
    );

  async function confirmed() {
    if (!confirm) return;
    let ok: boolean;
    if (confirm.kind === 'remove') {
      ok = await run(
        () => membershipCalls.removeMember({ workspaceId, uid: confirm.uid }),
        'Could not remove that person.',
        `${confirm.name} was removed.`,
      );
    } else if (confirm.kind === 'deleteTeam') {
      ok = await run(
        () => teamWrites.remove(workspaceId, confirm.teamId),
        'Could not delete the team.',
        `Deleted ${confirm.name}.`,
      );
    } else if (confirm.kind === 'transfer') {
      ok = await run(
        () => membershipCalls.changeMemberRole({ workspaceId, uid: confirm.uid, role: 'owner' }),
        'Could not transfer ownership.',
        `${confirm.name} is now the owner.`,
      );
    } else {
      ok = await run(
        () => membershipCalls.leaveWorkspace({ workspaceId }),
        'Could not leave the workspace.',
        'You left the workspace.',
      );
      if (ok) {
        onClose();
        void navigate('/');
        return;
      }
    }
    if (ok) setConfirm(null);
  }

  return (
    <Modal id="members-dialog" show size="medium" onClose={onClose}>
      <PopupLayer>
        <ModalBasicLayout>
          <ModalHeader title={`Members of ${workspace.name}`} />
          <ModalContent>
            <div className={styles.body}>
              <TabList
                activeTabId={tabs.indexOf(tab)}
                onTabChange={(id: number) => {
                  setTab(tabs[id] ?? 'members');
                  setConfirm(null);
                  setError(null);
                }}
              >
                {tabs.map((t) =>
                  t === 'members' ? (
                    <Tab key={t} icon={Person}>{`Members (${rows.length})`}</Tab>
                  ) : t === 'invites' ? (
                    <Tab key={t} icon={Invite}>
                      Invites
                    </Tab>
                  ) : (
                    <Tab key={t} icon={Team}>{`Teams (${teams.length})`}</Tab>
                  ),
                )}
              </TabList>

              {confirm ? (
                <ConfirmPanel
                  confirm={confirm}
                  workspaceName={workspace.name}
                  busy={busy}
                  onConfirm={() => void confirmed()}
                  onCancel={() => setConfirm(null)}
                />
              ) : tab === 'members' ? (
                <ul className={styles.list} aria-label="Members">
                  {rows.map((row) => (
                    <MemberRow
                      key={row.uid}
                      workspaceId={workspaceId}
                      row={row}
                      isSelf={row.uid === uid}
                      myRole={myRole}
                      busy={busy}
                      onChangeRole={(role) => void changeRole(row, role)}
                      onAsk={setConfirm}
                    />
                  ))}
                </ul>
              ) : tab === 'teams' ? (
                <TeamsTab
                  teams={teams}
                  people={people}
                  canManage={isAdmin}
                  onNew={() => setEditor({})}
                  onEdit={(team) => setEditor({ team })}
                  onDelete={(team) =>
                    setConfirm({ kind: 'deleteTeam', teamId: team.id, name: team.name })
                  }
                />
              ) : (
                <InvitesTab workspaceId={workspaceId} myRole={myRole} onError={setError} />
              )}

              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </ModalContent>
        </ModalBasicLayout>
      </PopupLayer>
    </Modal>
  );
}

function ConfirmPanel({
  confirm,
  workspaceName,
  busy,
  onConfirm,
  onCancel,
}: {
  confirm: Confirm;
  workspaceName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const text =
    confirm.kind === 'deleteTeam'
      ? `Delete ${confirm.name}? Items assigned to ${confirm.name} keep the entry but show "Deleted team".`
      : confirm.kind === 'remove'
        ? `Remove ${confirm.name} from ${workspaceName}? They lose access to its boards straight away.`
        : confirm.kind === 'transfer'
          ? `Make ${confirm.name} the owner of ${workspaceName}? You become an admin, and only the new owner can transfer ownership again.`
          : `Leave ${workspaceName}? You lose access to its boards until someone invites you again.`;
  const action =
    confirm.kind === 'deleteTeam'
      ? 'Delete team'
      : confirm.kind === 'remove'
        ? 'Remove'
        : confirm.kind === 'transfer'
          ? 'Transfer ownership'
          : 'Leave workspace';
  return (
    <div className={styles.confirm} role="alertdialog" aria-label={action}>
      <p className={styles.confirmText}>{text}</p>
      <div className={styles.confirmActions}>
        <Button
          kind="primary"
          color={confirm.kind === 'transfer' ? 'primary' : 'negative'}
          size="small"
          loading={busy}
          disabled={busy}
          onClick={onConfirm}
        >
          {action}
        </Button>
        <Button kind="tertiary" size="small" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TeamsTab({
  teams,
  people,
  canManage,
  onNew,
  onEdit,
  onDelete,
}: {
  teams: readonly TeamDoc[];
  people: readonly { uid: string; name: string; photoURL: string | null }[];
  canManage: boolean;
  onNew: () => void;
  onEdit: (team: TeamDoc) => void;
  onDelete: (team: TeamDoc) => void;
}) {
  const byUid = new Map(people.map((p) => [p.uid, p]));
  const atCap = teams.length >= TEAM_LIMITS.perWorkspace;
  return (
    <>
      {teams.length === 0 ? (
        <p className={teamStyles.empty}>
          {canManage
            ? 'No teams yet. Create one to assign a group of people at once.'
            : 'No teams yet. Owners and admins can create them.'}
        </p>
      ) : (
        <ul className={teamStyles.list} aria-label="Teams">
          {teams.map((team) => {
            const members = team.memberUids.filter((uid) => byUid.has(uid));
            return (
              <li key={team.id} className={teamStyles.row}>
                <div className={teamStyles.who}>
                  <TeamAvatar name={team.name} color={team.color} />
                  <div className={teamStyles.names}>
                    <span className={teamStyles.name}>{team.name}</span>
                    <span className={teamStyles.meta}>
                      {members.length === 1 ? '1 member' : `${members.length} members`}
                    </span>
                  </div>
                </div>
                <AvatarGroup max={4} size="small" type="img">
                  {members.map((uid) => (
                    <UserAvatar
                      key={uid}
                      uid={uid}
                      name={byUid.get(uid)?.name}
                      photoURL={byUid.get(uid)?.photoURL ?? null}
                    />
                  ))}
                </AvatarGroup>
                {canManage ? (
                  <MenuButton
                    size="small"
                    aria-label={`Actions for ${team.name}`}
                    closeMenuOnItemClick
                  >
                    <Menu id={`team-menu-${team.id}`} size="medium">
                      <MenuItem title="Edit" icon={Edit} onClick={() => onEdit(team)} />
                      <MenuItem title="Delete" icon={Delete} onClick={() => onDelete(team)} />
                    </Menu>
                  </MenuButton>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canManage ? (
        <div className={teamStyles.footer}>
          <Button kind="secondary" size="small" disabled={atCap} onClick={onNew}>
            New team
          </Button>
          {atCap ? (
            <span className={teamStyles.hint}>
              A workspace holds at most {TEAM_LIMITS.perWorkspace} teams.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function MemberRow({
  workspaceId,
  row,
  isSelf,
  myRole,
  busy,
  onChangeRole,
  onAsk,
}: {
  workspaceId: string;
  row: Row;
  isSelf: boolean;
  myRole: WorkspaceRole;
  busy: boolean;
  onChangeRole: (role: WorkspaceRole) => void;
  onAsk: (confirm: Confirm) => void;
}) {
  const actions = memberRowActions(myRole, row.role, isSelf);
  const hasMenu = actions.canTransfer || actions.canRemove || actions.canLeave;
  const options = roleOptions(actions.roleChoices);
  return (
    <li className={styles.row}>
      <div className={styles.person}>
        <ProfileLink
          uid={row.uid}
          workspaceId={workspaceId}
          name={row.name}
          photoURL={row.photoURL}
          label={`Profile of ${row.name}`}
        >
          <UserAvatar uid={row.uid} name={row.name} photoURL={row.photoURL} size="medium" />
          <div className={styles.names}>
            <span className={styles.name}>
              {row.name}
              {isSelf ? ' (you)' : ''}
            </span>
            {row.email ? <span className={styles.email}>{row.email}</span> : null}
          </div>
        </ProfileLink>
      </div>
      {options.length > 0 ? (
        <div className={styles.roleControl}>
          <Dropdown
            size="small"
            clearable={false}
            searchable={false}
            disabled={busy}
            aria-label={`Role for ${row.name}`}
            options={options}
            value={options.find((o) => o.value === row.role)}
            onChange={(selected: unknown) => {
              const option = toOption(selected);
              if (option && option.value !== row.role) onChangeRole(option.value as WorkspaceRole);
            }}
          />
        </div>
      ) : (
        <span className={styles.roleStatic}>{ROLE_LABEL[row.role]}</span>
      )}
      {hasMenu ? (
        <MenuButton size="small" aria-label={`Actions for ${row.name}`} closeMenuOnItemClick>
          <Menu id={`member-menu-${row.uid}`} size="medium">
            {actions.canTransfer ? (
              <MenuItem
                title="Transfer ownership"
                onClick={() => onAsk({ kind: 'transfer', uid: row.uid, name: row.name })}
              />
            ) : null}
            {actions.canRemove ? (
              <MenuItem
                title="Remove from workspace"
                icon={Delete}
                onClick={() => onAsk({ kind: 'remove', uid: row.uid, name: row.name })}
              />
            ) : null}
            {actions.canLeave ? (
              <MenuItem title="Leave workspace" onClick={() => onAsk({ kind: 'leave' })} />
            ) : null}
          </Menu>
        </MenuButton>
      ) : (
        <span />
      )}
    </li>
  );
}

function InvitesTab({
  workspaceId,
  myRole,
  onError,
}: {
  workspaceId: string;
  myRole: WorkspaceRole;
  onError: (message: string | null) => void;
}) {
  const roles = invitableRoles(myRole);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [sending, setSending] = useState(false);
  const { data: invites } = useWorkspaceInvites(workspaceId, true);
  const parsed = inviteEmailSchema.safeParse(email);

  async function send() {
    if (!parsed.success || sending) return;
    setSending(true);
    onError(null);
    try {
      const { inviteId } = await membershipCalls.createInvite({
        workspaceId,
        email: parsed.data,
        role,
      });
      setEmail('');
      await copyLink(inviteId, 'Invite created and link copied. Send it to them to join.');
    } catch (e) {
      console.error('Could not create the invite', e);
      onError(describeCallableError(e, 'Could not create the invite.'));
    } finally {
      setSending(false);
    }
  }

  async function copyLink(inviteId: string, success = 'Invite link copied.') {
    try {
      await navigator.clipboard.writeText(inviteLink(workspaceId, inviteId));
      showToast(success, { type: 'positive' });
    } catch {
      showToast(`Copy this link manually: ${inviteLink(workspaceId, inviteId)}`);
    }
  }

  async function revoke(inviteId: string) {
    onError(null);
    try {
      await membershipCalls.revokeInvite({ workspaceId, inviteId });
      showToast('Invite revoked.');
    } catch (e) {
      console.error('Could not revoke the invite', e);
      onError(describeCallableError(e, 'Could not revoke the invite.'));
    }
  }

  const options = roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  return (
    <>
      <form
        className={styles.inviteForm}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <TextField
          title="Email address"
          inputAriaLabel="Invitee email"
          placeholder="name@example.com"
          type="email"
          value={email}
          onChange={(value: string) => setEmail(value)}
          size="medium"
        />
        <div>
          <span className={styles.fieldLabel}>Role</span>
          <Dropdown
            size="medium"
            clearable={false}
            searchable={false}
            aria-label="Invite role"
            options={options}
            value={options.find((o) => o.value === role)}
            onChange={(selected: unknown) => {
              const option = toOption(selected);
              if (option) setRole(option.value as InviteRole);
            }}
          />
        </div>
        <Button type="submit" kind="primary" size="medium" disabled={!parsed.success || sending}>
          Invite
        </Button>
      </form>
      <p className={styles.hint}>
        Atrium does not send email yet. After inviting, copy the link and send it to them. They must
        sign in with the Google account for that email address.
      </p>

      <h3 className={styles.sectionTitle}>Pending invitations ({invites.length})</h3>
      {invites.length === 0 ? (
        <p className={styles.empty}>No pending invitations.</p>
      ) : (
        <ul className={styles.list} aria-label="Pending invitations">
          {invites.map((invite) => (
            <li key={invite.id} className={styles.row}>
              <div className={styles.names}>
                <span className={styles.name}>{invite.email}</span>
                <span className={styles.meta}>
                  {ROLE_LABEL[invite.role]} · {describeExpiry(invite.expiresAt.toMillis())}
                </span>
              </div>
              <span />
              <div className={styles.rowActions}>
                <Button kind="tertiary" size="small" onClick={() => void copyLink(invite.id)}>
                  Copy invite link
                </Button>
                <Button
                  kind="tertiary"
                  size="small"
                  color="negative"
                  onClick={() => void revoke(invite.id)}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
