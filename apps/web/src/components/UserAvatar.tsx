import { Avatar } from '@vibe/core';
import { Person, Robot } from '@vibe/icons';
import { AUTOMATION_ACTOR_NAME, isAutomationActor } from '../lib/automation-actor';
import { UNKNOWN_PERSON_NAME, useUserLookup } from '../data/members-store';
import { initialsOf } from '../lib/format';

type Size = 'xs' | 'small' | 'medium' | 'large';

/**
 * Avatar for a user id. Explicit name and photoURL win; otherwise the person is looked up among the
 * members of the workspace being shown, and unknown people get a neutral person avatar.
 */
export function UserAvatar({
  uid,
  name: explicitName,
  photoURL: explicitPhotoURL,
  size = 'small',
  customSize,
}: {
  uid: string;
  name?: string;
  photoURL?: string | null;
  size?: Size;
  /** Pixel size; overrides `size` (Vibe `Avatar` `customSize`). */
  customSize?: number;
}) {
  const person = useUserLookup()(uid);
  const name = explicitName ?? person?.name ?? UNKNOWN_PERSON_NAME;
  const photo = explicitPhotoURL !== undefined ? explicitPhotoURL : (person?.photoURL ?? null);

  if (isAutomationActor(uid)) {
    // Automations never get a photo or initials: a neutral robot icon.
    return (
      <Avatar
        type="icon"
        icon={Robot}
        size={size}
        customSize={customSize}
        backgroundColor="winter"
        aria-label={AUTOMATION_ACTOR_NAME}
      />
    );
  }
  if (photo) {
    return <Avatar type="img" src={photo} size={size} customSize={customSize} aria-label={name} />;
  }
  if (name && name !== UNKNOWN_PERSON_NAME) {
    return (
      <Avatar
        type="text"
        text={initialsOf(name)}
        size={size}
        customSize={customSize}
        backgroundColor="bright-blue"
        aria-label={name}
      />
    );
  }
  return (
    <Avatar
      type="icon"
      icon={Person}
      size={size}
      customSize={customSize}
      backgroundColor="winter"
      aria-label={name}
    />
  );
}
