import { useState, type ReactNode } from 'react';
import { isAutomationActor } from '../../lib/automation-actor';
import { ProfileCard } from './ProfileCard';
import styles from './profile-card.module.css';

/**
 * Makes `children` (an avatar, a name or both) a button that opens the person's profile card.
 * Automations have no profile, so for them the children are drawn as they are.
 */
export function ProfileLink({
  uid,
  name,
  photoURL,
  workspaceId,
  label,
  children,
}: {
  uid: string;
  /** Shown when the person is not a member of the workspace (for example an old update author). */
  name?: string;
  photoURL?: string | null;
  workspaceId?: string;
  /** Accessible name of the trigger. Omit when the children already name the person. */
  label?: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  if (isAutomationActor(uid)) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={label}
        onClick={(event) => {
          const target = event.currentTarget;
          setAnchor((current) => (current ? null : target));
        }}
      >
        {children}
      </button>
      {anchor ? (
        <ProfileCard
          uid={uid}
          anchor={anchor}
          workspaceId={workspaceId}
          fallbackName={name}
          fallbackPhotoURL={photoURL}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </>
  );
}
