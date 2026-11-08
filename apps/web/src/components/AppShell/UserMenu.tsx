import { Avatar, Menu, MenuButton, MenuDivider, MenuItem, MenuTitle } from '@vibe/core';
import { Check, Feedback, Inbox, Info, LogOut, Team } from '@vibe/icons';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useIsSiteAdmin } from '../../auth/useIsSiteAdmin';
import { useInboxUnreadCount } from '../../data/inbox';
import { formatInboxCount } from '../../pages/admin/inbox';
import { THEME_OPTIONS, useThemeStore } from '../../theme/theme';
import { useUiStore } from './ui-store';

function displayNameOf(user: { displayName: string | null; email: string | null } | null): string {
  return user?.displayName ?? user?.email ?? 'Account';
}

/** Profile photo, or initials when the Google account has none. */
function AccountAvatar() {
  const { user } = useAuth();
  const name = displayNameOf(user);
  if (user?.photoURL) {
    return <Avatar type="img" src={user.photoURL} size="small" aria-label={name} />;
  }
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Avatar
      type="text"
      text={initials}
      size="small"
      backgroundColor="bright-blue"
      aria-label={name}
    />
  );
}

/** Avatar button with theme switcher and sign-out. */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const openDialog = useUiStore((s) => s.openDialog);
  const name = displayNameOf(user);
  const isSiteAdmin = useIsSiteAdmin();
  const { count: inboxUnread } = useInboxUnreadCount(isSiteAdmin);
  const navigate = useNavigate();

  return (
    <MenuButton
      component={AccountAvatar}
      aria-label={`Account menu for ${name}`}
      closeMenuOnItemClick
    >
      <Menu id="account-menu" size="medium">
        <MenuTitle caption={user?.email ?? name} />
        <MenuDivider />
        <MenuTitle caption="Theme" />
        {THEME_OPTIONS.map(({ value, label }) => (
          <MenuItem
            key={value}
            title={label}
            icon={preference === value ? Check : undefined}
            onClick={() => setPreference(value)}
          />
        ))}
        <MenuDivider />
        <MenuItem
          title="Send feedback"
          icon={Feedback}
          onClick={() => openDialog({ type: 'feedback' })}
        />
        <MenuItem title="My feedback" icon={Inbox} onClick={() => void navigate('/feedback')} />
        <MenuItem title="About Atrium" icon={Info} onClick={() => openDialog({ type: 'about' })} />
        {isSiteAdmin ? (
          <MenuItem
            title={inboxUnread > 0 ? `Site admin (${formatInboxCount(inboxUnread)})` : 'Site admin'}
            icon={Team}
            onClick={() => void navigate('/admin')}
          />
        ) : null}
        <MenuItem title="Sign out" icon={LogOut} onClick={() => void signOut()} />
      </Menu>
    </MenuButton>
  );
}
