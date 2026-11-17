import { Button } from '@vibe/core';
import { Calendar, Email, Location, Time } from '@vibe/icons';
import { useEffect, useRef, useState } from 'react';
import { UNKNOWN_PERSON_NAME, useUserLookup } from '../../data/members-store';
import { useWorkspaceTeams } from '../../data/teams';
import { initialsOf } from '../../lib/format';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { TeamAvatar } from '../teams/TeamAvatar';
import { showToast } from '../toast-store';
import { formatBirthday, formatLocalTime } from './profile-format';
import styles from './profile-card.module.css';

export interface ProfileCardProps {
  /** The person to show. */
  uid: string;
  /** The element that opened the card; Escape returns focus to it. */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Workspace whose member docs and teams are read (default: the one the shell is showing). */
  workspaceId?: string;
  /** Used when the person isn't a member here (an update author who has since left). */
  fallbackName?: string;
  fallbackPhotoURL?: string | null;
}

/** How often the shown local time catches up with the clock. */
const CLOCK_TICK_MS = 30_000;

/**
 * A person's profile card (TEAMS spec, PR 5): name, photo, title, location, local time and birthday
 * when they chose to share them, the about text, their teams in this workspace and their email. Every
 * profile field is optional and a missing one is simply not drawn. The data comes from the member
 * doc through `useUserLookup`, so opening a card reads nothing extra.
 */
export function ProfileCard({
  uid,
  anchor,
  onClose,
  workspaceId,
  fallbackName,
  fallbackPhotoURL,
}: ProfileCardProps) {
  const person = useUserLookup(workspaceId)(uid);
  const { teams } = useWorkspaceTeams(workspaceId);
  const rootRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  const name = person?.name ?? fallbackName ?? UNKNOWN_PERSON_NAME;
  const photoURL = person ? person.photoURL : (fallbackPhotoURL ?? null);
  const email = person?.email ?? null;
  const profile = person?.profile;
  const myTeams = teams.filter((t) => t.memberUids.includes(uid));
  const localTime = formatLocalTime(profile?.timeZone, now);
  const birthday = profile?.birthday ? formatBirthday(profile.birthday) : null;

  // Move focus into the card so the keyboard user lands on it; Escape hands it back to the trigger.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!profile?.timeZone) return;
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [profile?.timeZone]);

  async function copyEmail() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      showToast('Email copied.', { type: 'positive' });
    } catch {
      showToast(`Copy this address manually: ${email}`);
    }
  }

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={`Profile of ${name}`}>
      <div ref={rootRef} className={styles.card} tabIndex={-1}>
        <div className={styles.head}>
          <span className={styles.avatar} aria-hidden="true">
            {photoURL ? (
              <img className={styles.photo} src={photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              initialsOf(name)
            )}
          </span>
          <div className={styles.who}>
            <h2 className={styles.name}>{name}</h2>
            {profile?.title ? <span className={styles.title}>{profile.title}</span> : null}
          </div>
        </div>

        {localTime || profile?.location || birthday ? (
          <ul className={styles.facts} aria-label="Details">
            {localTime ? (
              <li className={styles.fact}>
                <Time className={styles.factIcon} size={16} aria-hidden="true" />
                <span>Local time {localTime}</span>
              </li>
            ) : null}
            {profile?.location ? (
              <li className={styles.fact}>
                <Location className={styles.factIcon} size={16} aria-hidden="true" />
                <span>{profile.location}</span>
              </li>
            ) : null}
            {birthday ? (
              <li className={styles.fact}>
                <Calendar className={styles.factIcon} size={16} aria-hidden="true" />
                <span>Birthday: {birthday}</span>
              </li>
            ) : null}
          </ul>
        ) : null}

        {profile?.about ? <p className={styles.about}>{profile.about}</p> : null}

        {myTeams.length > 0 ? (
          <ul className={styles.teams} aria-label="Teams">
            {myTeams.map((team) => (
              <li key={team.id} className={styles.teamChip}>
                <TeamAvatar name={team.name} color={team.color} size="sm" />
                <span className={styles.teamName}>{team.name}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {email ? (
          <div className={styles.emailRow}>
            <Email className={styles.factIcon} size={16} aria-hidden="true" />
            <span className={styles.email}>{email}</span>
            <Button
              kind="tertiary"
              size="xs"
              aria-label={`Copy email of ${name}`}
              onClick={() => void copyEmail()}
            >
              Copy
            </Button>
          </div>
        ) : null}
      </div>
    </AnchoredPopup>
  );
}
