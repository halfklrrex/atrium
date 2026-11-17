import type { PeopleSettings, PeopleValue, PersonOrTeam } from '@atrium/shared';
import { Person, PersonRound } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { DELETED_TEAM_NAME, useTeamLookup, useWorkspaceTeams } from '../data/teams';
import { UNKNOWN_PERSON_NAME, useUserLookup, useWorkspaceMembers } from '../data/members-store';
import { ProfileLink } from '../components/profile';
import { TeamAvatar } from '../components/teams/TeamAvatar';
import { initialsOf } from '../lib/format';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

const MAX_AVATARS = 3;

/** Who a user id is: a workspace member's name and photo, or a neutral "Board member". */
function usePerson(uid: string) {
  const person = useUserLookup()(uid);
  return {
    known: Boolean(person),
    name: person?.name ?? UNKNOWN_PERSON_NAME,
    photoURL: person?.photoURL ?? null,
  };
}

function Avatar({ uid }: { uid: string }) {
  const { known, name, photoURL } = usePerson(uid);
  return (
    <span
      className={classNames(styles.avatar, !known && styles.avatarOther)}
      role="img"
      aria-label={name}
      title={name}
    >
      {photoURL ? (
        <img src={photoURL} alt="" referrerPolicy="no-referrer" />
      ) : known ? (
        initialsOf(name)
      ) : (
        <Person aria-hidden="true" />
      )}
    </span>
  );
}

/** A team entry in the avatar stack: the team color and initials, or a gray "Deleted team". */
function TeamEntryAvatar({ id }: { id: string }) {
  const team = useTeamLookup()(id);
  const name = team?.name ?? DELETED_TEAM_NAME;
  return (
    <span
      className={classNames(styles.avatar, styles.avatarTeam, !team && styles.avatarOther)}
      role="img"
      aria-label={name}
      title={name}
      style={team ? { backgroundColor: team.color } : undefined}
    >
      {team ? initialsOf(name) : <Person aria-hidden="true" />}
    </span>
  );
}

function PeopleCell({ value }: CellProps<PeopleValue, PeopleSettings>) {
  const people = value?.personsAndTeams ?? [];
  if (people.length === 0) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <PersonRound aria-hidden="true" />
        </span>
      </div>
    );
  }
  const shown = people.slice(0, MAX_AVATARS);
  const extra = people.length - shown.length;
  return (
    <div className={styles.root}>
      <span className={styles.avatars}>
        {shown.map((p) =>
          p.kind === 'team' ? (
            <TeamEntryAvatar key={`team:${p.id}`} id={p.id} />
          ) : (
            <Avatar key={p.id} uid={p.id} />
          ),
        )}
        {extra > 0 ? (
          <span className={classNames(styles.avatar, styles.avatarMore)}>+{extra}</span>
        ) : null}
      </span>
    </div>
  );
}

/** One selectable member row (avatar and name); also used by the button column's notify picker. */
export function PersonRow({
  uid,
  selected,
  onToggle,
}: {
  uid: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const { name } = usePerson(uid);
  // The avatar opens the person's profile card, so it sits beside the option: a control can't nest
  // inside an option, and the rest of the row still toggles the selection.
  return (
    <div role="presentation" className={classNames(popups.listRow, selected && popups.listRowOn)}>
      <ProfileLink uid={uid} name={name} label={`Profile of ${name}`}>
        <Avatar uid={uid} />
      </ProfileLink>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={popups.listRowOption}
        onClick={onToggle}
      >
        {name}
      </button>
    </div>
  );
}

/** One selectable team row (team avatar and name), in the picker's "Teams" section. */
function TeamRow({
  id,
  selected,
  onToggle,
}: {
  id: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const team = useTeamLookup()(id);
  const name = team?.name ?? DELETED_TEAM_NAME;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={classNames(popups.listRow, selected && popups.listRowOn)}
      onClick={onToggle}
    >
      <TeamAvatar name={name} color={team?.color ?? null} size="sm" />
      <span>{name}</span>
    </button>
  );
}

function PeopleEditor({
  value,
  settings,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<PeopleValue, PeopleSettings>) {
  const { user } = useAuth();
  const lookup = useUserLookup();
  const { members } = useWorkspaceMembers();
  const [query, setQuery] = useState('');
  const current = value?.personsAndTeams ?? [];
  const selectedPeople = new Set(current.filter((p) => p.kind === 'person').map((p) => p.id));
  const selectedTeams = new Set(current.filter((p) => p.kind === 'team').map((p) => p.id));
  const { teams } = useWorkspaceTeams();

  // The picker lists the workspace's members, plus anyone already on the cell who has since left.
  const memberIds = members.map((m) => m.id);
  const known = new Set(memberIds);
  // The signed-in user is always offered, even before their member profile has been written.
  if (user && !known.has(user.uid)) {
    memberIds.unshift(user.uid);
    known.add(user.uid);
  }
  const candidates = [
    ...memberIds,
    ...current.filter((p) => p.kind === 'person' && !known.has(p.id)).map((p) => p.id),
  ];
  const needle = query.trim().toLowerCase();
  const visible = candidates.filter((id) => {
    if (!needle) return true;
    const person = lookup(id);
    const haystack = `${person?.name ?? UNKNOWN_PERSON_NAME} ${person?.email ?? ''}`.toLowerCase();
    return haystack.includes(needle);
  });

  // Teams of the workspace (a deleted team stays listed while it is still on the cell, to remove it).
  const teamIds = [
    ...teams.map((t) => t.id),
    ...[...selectedTeams].filter((id) => !teams.some((t) => t.id === id)),
  ];
  const visibleTeams = teamIds.filter((id) => {
    if (!needle) return true;
    const team = teams.find((t) => t.id === id);
    return (team?.name ?? DELETED_TEAM_NAME).toLowerCase().includes(needle);
  });

  const write = (next: PersonOrTeam[]) =>
    onChange(next.length > 0 ? { personsAndTeams: next } : null);

  const toggle = (id: string, kind: PersonOrTeam['kind'] = 'person') => {
    const selected = kind === 'team' ? selectedTeams.has(id) : selectedPeople.has(id);
    if (selected) {
      write(current.filter((p) => !(p.id === id && p.kind === kind)));
    } else if (settings.singlePerson) {
      write([{ id, kind }]);
      onClose();
    } else {
      write([...current, { id, kind }]);
    }
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        <input
          className={popups.input}
          value={query}
          placeholder="Search names"
          aria-label="Search people"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className={popups.list} role="listbox" aria-label="People" aria-multiselectable>
          {visible.length === 0 && visibleTeams.length === 0 ? (
            <p className={popups.muted}>No one found</p>
          ) : (
            visible.map((id) => (
              <PersonRow
                key={id}
                uid={id}
                selected={selectedPeople.has(id)}
                onToggle={() => toggle(id)}
              />
            ))
          )}
          {visibleTeams.length > 0 ? (
            <div role="group" aria-label="Teams">
              <p className={popups.sectionLabel}>Teams</p>
              {visibleTeams.map((id) => (
                <TeamRow
                  key={`team:${id}`}
                  id={id}
                  selected={selectedTeams.has(id)}
                  onToggle={() => toggle(id, 'team')}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className={popups.footer}>
          <button
            type="button"
            className={popups.linkButton}
            disabled={current.length === 0}
            onClick={() => {
              onChange(null);
              onClose();
            }}
          >
            Remove all
          </button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const peopleUi = defineColumnUi<PeopleValue, PeopleSettings>({
  type: 'people',
  icon: Person,
  tone: 'blue',
  editor: 'popover',
  Cell: PeopleCell,
  Editor: PeopleEditor,
});
