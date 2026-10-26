import { Button, Icon } from '@vibe/core';
import { Check, Person } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import type { BoardDoc, ItemDoc } from '../../data';
import { Popover } from '../Popover';
import { UserAvatar } from '../UserAvatar';
import styles from './board-filters.module.css';
import { useBoardFilter } from './filter-store';

export interface PersonFilterPopoverProps {
  board?: BoardDoc | null;
  items?: ItemDoc[];
  userLookup?: (uid: string) => string | undefined;
}

export function PersonFilterPopover({ board, items = [], userLookup }: PersonFilterPopoverProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { filterState, togglePersonFilter, setPersonIds } = useBoardFilter(board?.id);
  const selectedPersonIds = filterState.personIds;

  // Extract all distinct assigned people from items (or board access uids)
  const availablePeople = useMemo(() => {
    const peopleSet = new Set<string>();

    // Scan items for people column assignments
    for (const item of items) {
      if (item.values) {
        for (const col of board?.columns || []) {
          if (col.type === 'people') {
            const val = item.values[col.id] as { personsAndTeams?: { id: string }[] } | undefined;
            if (val?.personsAndTeams) {
              for (const p of val.personsAndTeams) {
                if (p.id) peopleSet.add(p.id);
              }
            }
          }
        }
      }
    }

    // Also include board access members if none found in items
    if (peopleSet.size === 0 && board?.accessUids) {
      for (const uid of board.accessUids) {
        peopleSet.add(uid);
      }
    }

    return Array.from(peopleSet);
  }, [items, board]);

  const activeCount = selectedPersonIds.length;

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Filter by person"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          leftIcon={Person}
          className={classNames(activeCount > 0 && styles.activeButton)}
          onClick={() => setOpen((v) => !v)}
          aria-label="Filter by person"
        >
          Person
          {activeCount > 0 ? <span className={styles.badge}>{activeCount}</span> : null}
        </Button>
      }
    >
      <div className={classNames(styles.popoverPanel, styles.personPanel)}>
        <div className={styles.popoverHeader}>
          <span className={styles.popoverTitle}>Filter by person</span>
          {activeCount > 0 ? (
            <Button kind="tertiary" size="small" onClick={() => setPersonIds([])}>
              Clear
            </Button>
          ) : null}
        </div>

        {availablePeople.length === 0 ? (
          <div className={styles.emptyState}>No assigned people on this board yet.</div>
        ) : (
          <div className={styles.personList} role="listbox" aria-label="People on board">
            {availablePeople.map((uid) => {
              const isSelected = selectedPersonIds.includes(uid);
              const displayName =
                userLookup?.(uid) ??
                (uid === user?.uid ? (user?.displayName ?? user?.email ?? 'You') : 'Board member');
              return (
                <button
                  key={uid}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={classNames(styles.personRow, isSelected && styles.personRowSelected)}
                  onClick={() => togglePersonFilter(uid)}
                >
                  <UserAvatar uid={uid} size="small" />
                  <span className={styles.personName}>{displayName}</span>
                  {isSelected ? <Icon icon={Check} size={16} /> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Popover>
  );
}
