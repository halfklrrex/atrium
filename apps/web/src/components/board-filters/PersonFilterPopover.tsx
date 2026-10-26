import { Button, Icon } from '@vibe/core';
import { Check, Person } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { UNKNOWN_PERSON_NAME, useUserLookup, useWorkspaceMembers } from '../../data/members-store';
import type { BoardDoc, ItemDoc } from '../../data/model';
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
  const memberLookup = useUserLookup(board?.workspaceId);
  const { members } = useWorkspaceMembers(board?.workspaceId);
  const [open, setOpen] = useState(false);
  const { filterState, togglePersonFilter, setPersonIds } = useBoardFilter(board?.id);
  const selectedPersonIds = filterState.personIds;

  // Extract all distinct assigned people from items (or the workspace's members)
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

    // With nobody assigned yet, offer every member of the workspace.
    if (peopleSet.size === 0) {
      for (const member of members) peopleSet.add(member.id);
    }

    return Array.from(peopleSet);
  }, [items, board, members]);

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
                userLookup?.(uid) ?? memberLookup(uid)?.name ?? UNKNOWN_PERSON_NAME;
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
