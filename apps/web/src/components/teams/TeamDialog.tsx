import { TEAM_LIMITS, teamInputSchema } from '@atrium/shared';
import {
  Checkbox,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Search,
  TextField,
} from '@vibe/core';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import type { TeamDoc } from '../../data';
import { teamWrites } from '../../data/teams';
import { describeError } from '../boards/board-actions';
import dialogStyles from '../dialogs/dialogs.module.css';
import { submitOnEnter } from '../dialogs/submitOnEnter';
import { GROUP_COLORS } from '../../theme/palette';
import { showToast } from '../toast-store';
import { UserAvatar } from '../UserAvatar';
import styles from './teams.module.css';

export interface TeamPerson {
  uid: string;
  name: string;
  email: string;
  photoURL: string | null;
}

/** Shown when the saved team still lists someone who has left the workspace (rules refuse that). */
export const STALE_MEMBER_MESSAGE =
  'Someone in this team left the workspace. Remove them and save again.';

/** Create or edit a team: name, color and a searchable checklist of the workspace's members. */
export function TeamDialog({
  workspaceId,
  team,
  people,
  onClose,
}: {
  workspaceId: string;
  /** The team to edit; omit to create one. */
  team?: TeamDoc;
  people: readonly TeamPerson[];
  onClose: () => void;
}) {
  const currentUids = useMemo(() => new Set(people.map((p) => p.uid)), [people]);
  const stale = team ? team.memberUids.filter((uid) => !currentUids.has(uid)) : [];
  const [name, setName] = useState(team?.name ?? '');
  const [color, setColor] = useState(team?.color ?? GROUP_COLORS[17]!.hex);
  // People who already left are pre-unchecked (dropped), as the stale-member message promises.
  const [selected, setSelected] = useState<string[]>(
    team ? team.memberUids.filter((uid) => currentUids.has(uid)) : [],
  );
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(stale.length > 0 ? STALE_MEMBER_MESSAGE : null);

  const parsed = teamInputSchema.safeParse({ name, color, memberUids: selected });
  const atCap = selected.length >= TEAM_LIMITS.members;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(needle))
    : people;

  function toggle(uid: string) {
    setSelected((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]));
  }

  async function submit() {
    if (!parsed.success || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (team) await teamWrites.update(workspaceId, team.id, parsed.data);
      else await teamWrites.create(workspaceId, parsed.data);
      showToast(team ? 'Team saved.' : `Created ${parsed.data.name}.`, { type: 'positive' });
      onClose();
    } catch (e) {
      console.error('Could not save the team', e);
      setError(describeError(e, 'Could not save the team.'));
      setSubmitting(false);
    }
  }

  return (
    <Modal id="team-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title={team ? 'Edit team' : 'New team'} />
        <ModalContent>
          <form
            className={dialogStyles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <TextField
              id="team-name"
              title="Team name"
              inputAriaLabel="Team name"
              placeholder="Kids, Parents, Garden crew"
              value={name}
              onChange={(value: string) => setName(value)}
              onKeyDown={submitOnEnter(() => void submit())}
              maxLength={TEAM_LIMITS.name}
              autoFocus
              size="medium"
            />
            <div>
              <span className={dialogStyles.fieldLabel}>Color</span>
              <div className={dialogStyles.swatches} role="radiogroup" aria-label="Team color">
                {GROUP_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    role="radio"
                    aria-checked={color.toLowerCase() === c.hex}
                    aria-label={c.label}
                    title={c.label}
                    className={classNames(
                      dialogStyles.swatch,
                      color.toLowerCase() === c.hex && dialogStyles.swatchSelected,
                    )}
                    style={{ backgroundColor: c.hex }}
                    onClick={() => setColor(c.hex)}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className={dialogStyles.fieldLabel}>
                Members{' '}
                <span
                  className={styles.counter}
                >{`(${selected.length}/${TEAM_LIMITS.members})`}</span>
              </span>
              <Search
                value={query}
                onChange={(value: string) => setQuery(value)}
                placeholder="Search people"
                inputAriaLabel="Search people"
                size="small"
              />
              <ul className={styles.memberList} aria-label="Workspace members">
                {shown.map((p) => {
                  const checked = selected.includes(p.uid);
                  return (
                    <li key={p.uid} className={styles.memberRow}>
                      <Checkbox
                        checked={checked}
                        disabled={!checked && atCap}
                        onChange={() => toggle(p.uid)}
                        aria-label={p.name}
                        label={
                          <span className={styles.memberLabel}>
                            <UserAvatar
                              uid={p.uid}
                              name={p.name}
                              photoURL={p.photoURL}
                              size="small"
                            />
                            <span className={styles.name}>{p.name}</span>
                          </span>
                        }
                      />
                    </li>
                  );
                })}
                {shown.length === 0 ? <li className={styles.empty}>No one matches.</li> : null}
              </ul>
              {atCap ? (
                <p className={styles.hint}>A team holds at most {TEAM_LIMITS.members} people.</p>
              ) : null}
            </div>
            {error ? (
              <p className={dialogStyles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" hidden />
          </form>
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter
        primaryButton={{
          text: team ? 'Save' : 'Create team',
          onClick: () => void submit(),
          disabled: !parsed.success || submitting,
          loading: submitting,
        }}
        secondaryButton={{ text: 'Cancel', onClick: onClose, disabled: submitting }}
      />
    </Modal>
  );
}
