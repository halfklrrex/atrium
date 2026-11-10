import { Key, Locked, Moon, Notifications, Person } from '@vibe/icons';
import type { ComponentType } from 'react';

export type SettingsTab = 'profile' | 'appearance' | 'notifications' | 'account' | 'privacy';

export interface SettingsTabInfo {
  id: SettingsTab;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

export interface SettingsGroup {
  label: 'You' | 'Account';
  tabs: readonly SettingsTabInfo[];
}

/** The nav groups, in order. Shared by the desktop nav (and later the phone index). */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    label: 'You',
    tabs: [
      {
        id: 'profile',
        label: 'Profile',
        hint: 'How you appear to others, and the details Atrium uses for you.',
        icon: Person,
      },
      {
        id: 'appearance',
        label: 'Appearance',
        hint: 'How Atrium looks on your devices.',
        icon: Moon,
      },
      {
        id: 'notifications',
        label: 'Notifications',
        hint: 'What notifies you, in the bell and on your devices.',
        icon: Notifications,
      },
    ],
  },
  {
    label: 'Account',
    tabs: [
      { id: 'account', label: 'Account', hint: 'How you sign in.', icon: Key },
      {
        id: 'privacy',
        label: 'Privacy and data',
        hint: 'Your data, the privacy notice and the source code.',
        icon: Locked,
      },
    ],
  },
];

/** Size in px of the identity card's avatar (a Vibe numeric prop, not a style). Matches the card's 64 px design. */
export const IDENTITY_AVATAR_SIZE = 64;
