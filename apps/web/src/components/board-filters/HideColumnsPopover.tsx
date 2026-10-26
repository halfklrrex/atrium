import { Button, Checkbox, Icon } from '@vibe/core';
import { Hide, Search } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { getColumnUi } from '../../columns/registry';
import type { BoardDoc } from '../../data';
import { comparePositions } from '../../lib/positions';
import { Popover } from '../Popover';
import styles from './board-filters.module.css';
import { useFilterStore, useHiddenColumnIds } from './filter-store';

/**
 * The toolbar's "Hide": pick which board columns this view shows. Checked means shown. The Item
 * (name) column is not listed because it can't be hidden. Changes count as unsaved view changes.
 */
export function HideColumnsPopover({ board }: { board?: BoardDoc | null }) {
  const boardId = board?.id ?? '';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const hiddenIds = useHiddenColumnIds(boardId);

  const columns = useMemo(
    () => [...(board?.columns ?? [])].sort(comparePositions),
    [board?.columns],
  );
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const hiddenCount = columns.filter((c) => hidden.has(c.id)).length;
  const term = search.trim().toLowerCase();
  const shown = term ? columns.filter((c) => c.title.toLowerCase().includes(term)) : columns;

  const setHidden = (ids: string[]) => useFilterStore.getState().setHiddenColumnIds(boardId, ids);
  const toggle = (columnId: string) =>
    setHidden(
      hidden.has(columnId) ? hiddenIds.filter((id) => id !== columnId) : [...hiddenIds, columnId],
    );

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Hide columns"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          leftIcon={Hide}
          className={classNames(hiddenCount > 0 && styles.activeButton)}
          onClick={() => setOpen((v) => !v)}
          aria-label={hiddenCount > 0 ? `Hide columns, ${hiddenCount} hidden` : 'Hide columns'}
        >
          Hide
          {hiddenCount > 0 ? <span className={styles.badge}>{hiddenCount}</span> : null}
        </Button>
      }
    >
      <div className={classNames(styles.popoverPanel, styles.hidePanel)}>
        <div className={styles.popoverHeader}>
          <span className={styles.popoverTitle}>Display columns</span>
        </div>

        <label className={styles.hideSearch}>
          <Icon icon={Search} size={16} />
          <input
            className={styles.hideSearchInput}
            value={search}
            placeholder="Find columns"
            aria-label="Find columns"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <div className={styles.hideActions}>
          <Button
            kind="tertiary"
            size="small"
            disabled={hiddenCount === columns.length || columns.length === 0}
            onClick={() => setHidden(columns.map((c) => c.id))}
          >
            Hide all
          </Button>
          <Button
            kind="tertiary"
            size="small"
            disabled={hiddenCount === 0}
            onClick={() => setHidden([])}
          >
            Show all
          </Button>
        </div>

        {columns.length === 0 ? (
          <div className={styles.emptyState}>This board has no columns yet.</div>
        ) : shown.length === 0 ? (
          <div className={styles.emptyState}>No columns match.</div>
        ) : (
          <ul className={styles.hideList} aria-label="Columns">
            {shown.map((column) => {
              const ColumnIcon = getColumnUi(column.type)?.icon;
              return (
                <li key={column.id} className={styles.hideRow}>
                  <Checkbox
                    checked={!hidden.has(column.id)}
                    onChange={() => toggle(column.id)}
                    aria-label={column.title}
                    label={
                      <span className={styles.hideLabel}>
                        {ColumnIcon ? <Icon icon={ColumnIcon} size={16} /> : null}
                        <span>{column.title}</span>
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Popover>
  );
}
