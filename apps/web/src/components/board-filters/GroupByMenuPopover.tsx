import { Button, Icon } from '@vibe/core';
import { Check, Group } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import type { BoardDoc } from '../../data';
import { Popover } from '../Popover';
import styles from './board-filters.module.css';
import { useBoardFilter } from './filter-store';

export function GroupByMenuPopover({ board }: { board?: BoardDoc | null }) {
  const [open, setOpen] = useState(false);
  const { filterState, setGroupBy } = useBoardFilter(board?.id);
  const activeGroupId = filterState.groupByColumnId;

  const columns = board?.columns || [];
  const activeCol = columns.find((c) => c.id === activeGroupId);
  const isGrouped = activeGroupId !== null;

  const handleSelectGroup = (colId: string | null) => {
    setGroupBy(colId);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Group board items"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          leftIcon={Group}
          className={classNames(isGrouped && styles.activeButton)}
          onClick={() => setOpen((v) => !v)}
          aria-label={isGrouped && activeCol ? `Group by: ${activeCol.title}` : 'Group by'}
        >
          {isGrouped && activeCol ? `Group by: ${activeCol.title}` : 'Group by'}
        </Button>
      }
    >
      <div className={classNames(styles.popoverPanel, styles.groupByPanel)}>
        <div className={styles.popoverHeader}>
          <span className={styles.popoverTitle}>Group by</span>
        </div>

        <div className={styles.groupByList} role="listbox" aria-label="Group by column options">
          <button
            type="button"
            role="option"
            aria-selected={activeGroupId === null}
            className={classNames(
              styles.groupByItem,
              activeGroupId === null && styles.groupByItemSelected,
            )}
            onClick={() => handleSelectGroup(null)}
          >
            <span>Default groups</span>
            {activeGroupId === null ? <Icon icon={Check} size={16} /> : null}
          </button>

          {columns.map((c) => {
            const isSelected = activeGroupId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={classNames(styles.groupByItem, isSelected && styles.groupByItemSelected)}
                onClick={() => handleSelectGroup(c.id)}
              >
                <span>{c.title}</span>
                {isSelected ? <Icon icon={Check} size={16} /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
