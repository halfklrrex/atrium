import type { PeopleSettings, PeopleValue, PersonOrTeam } from '@atrium/shared';
import { Person, PersonRound } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { initialsOf } from '../lib/format';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

const MAX_AVATARS = 3;

/**
 * Who a user id is. Only the signed-in user's own profile is readable until P4, so everyone else
 * is a neutral "Board member" avatar.
 */
function usePerson(uid: string) {
  const { user } = useAuth();
  const isMe = user?.uid === uid;
  const name = isMe ? (user?.displayName ?? user?.email ?? 'You') : 'Board member';
  return { isMe, name, photoURL: isMe ? (user?.photoURL ?? null) : null };
}

function Avatar({ uid }: { uid: string }) {
  const { isMe, name, photoURL } = usePerson(uid);
  return (
    <span
      className={classNames(styles.avatar, !isMe && styles.avatarOther)}
      role="img"
      aria-label={name}
      title={name}
    >
      {photoURL ? (
        <img src={photoURL} alt="" referrerPolicy="no-referrer" />
      ) : isMe ? (
        initialsOf(name)
      ) : (
        <Person aria-hidden="true" />
      )}
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
        {shown.map((p) => (
          <Avatar key={p.id} uid={p.id} />
        ))}
        {extra > 0 ? (
          <span className={classNames(styles.avatar, styles.avatarMore)}>+{extra}</span>
        ) : null}
      </span>
    </div>
  );
}

function PersonRow({
  uid,
  selected,
  onToggle,
}: {
  uid: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const { name } = usePerson(uid);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={classNames(popups.listRow, selected && popups.listRowOn)}
      onClick={onToggle}
    >
      <Avatar uid={uid} />
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
  const [query, setQuery] = useState('');
  const current = value?.personsAndTeams ?? [];
  const selectedIds = new Set(current.map((p) => p.id));

  // Workspace members whose profile the caller can read: for now that is the caller themself, plus
  // anyone already on the cell (shown as "Board member").
  const candidates = [
    ...(user ? [user.uid] : []),
    ...current.map((p) => p.id).filter((id) => id !== user?.uid),
  ];
  const needle = query.trim().toLowerCase();
  const visible = candidates.filter((id) => {
    if (!needle) return true;
    const label = id === user?.uid ? (user.displayName ?? user.email ?? 'you') : 'board member';
    return label.toLowerCase().includes(needle);
  });

  const write = (next: PersonOrTeam[]) =>
    onChange(next.length > 0 ? { personsAndTeams: next } : null);

  const toggle = (id: string) => {
    if (selectedIds.has(id)) {
      write(current.filter((p) => p.id !== id));
    } else if (settings.singlePerson) {
      write([{ id, kind: 'person' }]);
      onClose();
    } else {
      write([...current, { id, kind: 'person' }]);
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
          {visible.length === 0 ? (
            <p className={popups.muted}>No one found</p>
          ) : (
            visible.map((id) => (
              <PersonRow
                key={id}
                uid={id}
                selected={selectedIds.has(id)}
                onToggle={() => toggle(id)}
              />
            ))
          )}
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
