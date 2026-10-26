import {
  canManageWorkspace,
  inviteEmailSchema,
  invitableRoles,
  type InviteRole,
  type WorkspaceRole,
} from '@atrium/shared';
import {
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
import { Delete, Invite, Person } from '@vibe/icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useWorkspace, useWorkspaceInvites, useWorkspaceMembers } from '../../data';
import { describeCallableError, membershipCalls } from '../../lib/callables';
import { showToast } from '../toast-store';
import { UserAvatar } from '../UserAvatar';
import styles from './MembersDialog.module.css';
import { memberRowActions } from './permissions';
import { ROLE_LABEL, describeExpiry, inviteLink } from './roles';

type DialogTab = 'members' | 'invites';

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
  | { kind: 'leave' };

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
    initialTab === 'invites' && isAdmin ? 'invites' : 'members',
  );
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!workspace || !myRole) return null;

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
      <ModalBasicLayout>
        <ModalHeader title={`Members of ${workspace.name}`} />
        <ModalContent>
          <div className={styles.body}>
            {isAdmin ? (
              <TabList
                activeTabId={tab === 'members' ? 0 : 1}
                onTabChange={(id: number) => {
                  setTab(id === 0 ? 'members' : 'invites');
                  setConfirm(null);
                  setError(null);
                }}
              >
                <Tab icon={Person}>{`Members (${rows.length})`}</Tab>
                <Tab icon={Invite}>Invites</Tab>
              </TabList>
            ) : null}

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
                    row={row}
                    isSelf={row.uid === uid}
                    myRole={myRole}
                    busy={busy}
                    onChangeRole={(role) => void changeRole(row, role)}
                    onAsk={setConfirm}
                  />
                ))}
              </ul>
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
    confirm.kind === 'remove'
      ? `Remove ${confirm.name} from ${workspaceName}? They lose access to its boards straight away.`
      : confirm.kind === 'transfer'
        ? `Make ${confirm.name} the owner of ${workspaceName}? You become an admin, and only the new owner can transfer ownership again.`
        : `Leave ${workspaceName}? You lose access to its boards until someone invites you again.`;
  const action =
    confirm.kind === 'remove'
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

function MemberRow({
  row,
  isSelf,
  myRole,
  busy,
  onChangeRole,
  onAsk,
}: {
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
        <UserAvatar uid={row.uid} name={row.name} photoURL={row.photoURL} size="medium" />
        <div className={styles.names}>
          <span className={styles.name}>
            {row.name}
            {isSelf ? ' (you)' : ''}
          </span>
          {row.email ? <span className={styles.email}>{row.email}</span> : null}
        </div>
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
