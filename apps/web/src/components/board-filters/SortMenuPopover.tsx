import { Button, Dropdown, IconButton } from '@vibe/core';
import { Add, Delete, Sort, SortAscending, SortDescending } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import type { ColumnDef, SortCondition } from '@atrium/shared';
import type { BoardDoc } from '../../data';
import { Popover } from '../Popover';
import styles from './board-filters.module.css';
import { useBoardFilter } from './filter-store';

type DropdownOption = { value: string; label: string };

function toOption(selected: unknown): DropdownOption | null {
  if (!selected) return null;
  if (Array.isArray(selected)) return (selected[0] as DropdownOption) ?? null;
  return selected as DropdownOption;
}

const EMPTY_COLUMNS: readonly ColumnDef[] = [];

export function SortMenuPopover({ board }: { board?: BoardDoc | null }) {
  const [open, setOpen] = useState(false);
  const { filterState, setSortConditions } = useBoardFilter(board?.id);
  const { sortConditions } = filterState;
  const isSorted = sortConditions.length > 0;

  const columns = board?.columns ?? EMPTY_COLUMNS;
  const colOptions = useMemo(
    () => [
      { value: 'name', label: 'Item name' },
      ...columns.map((c) => ({ value: c.id, label: c.title })),
    ],
    [columns],
  );

  const handleAddSort = () => {
    // Pick the first column not already sorted, or default to name
    const sortedColIds = new Set(sortConditions.map((s) => s.columnId));
    let nextColId = 'name';
    if (sortedColIds.has('name')) {
      const unusedCol = columns.find((c) => !sortedColIds.has(c.id));
      if (unusedCol) nextColId = unusedCol.id;
    }
    setSortConditions([...sortConditions, { columnId: nextColId, direction: 'asc' }]);
  };

  const handleUpdateSort = (index: number, patch: Partial<SortCondition>) => {
    const next = sortConditions.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setSortConditions(next);
  };

  const handleRemoveSort = (index: number) => {
    setSortConditions(sortConditions.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    setSortConditions([]);
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Sort board items"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          leftIcon={Sort}
          className={classNames(isSorted && styles.activeButton)}
          onClick={() => setOpen((v) => !v)}
          aria-label="Sort"
        >
          Sort
          {isSorted ? <span className={styles.badge}>{sortConditions.length}</span> : null}
        </Button>
      }
    >
      <div className={classNames(styles.popoverPanel, styles.sortPanel)}>
        <div className={styles.popoverHeader}>
          <span className={styles.popoverTitle}>Sort by</span>
          {isSorted ? (
            <Button kind="tertiary" size="small" onClick={handleClearAll}>
              Clear sort
            </Button>
          ) : null}
        </div>

        {sortConditions.length === 0 ? (
          <div className={styles.emptyState}>No sort applied.</div>
        ) : (
          <div>
            {sortConditions.map((sort, index) => (
              <div
                key={index}
                className={styles.sortRuleRow}
                role="group"
                aria-label="Sort condition"
              >
                <span className={styles.sortPrefix}>{index === 0 ? 'Sort by' : 'Then by'}</span>

                <div className={styles.ruleDropdown}>
                  <Dropdown
                    size="small"
                    clearable={false}
                    placeholder="Select column"
                    aria-label="Sort column"
                    options={colOptions}
                    value={colOptions.find((o) => o.value === sort.columnId) ?? colOptions[0]}
                    onChange={(selected: unknown) => {
                      const opt = toOption(selected);
                      if (opt) handleUpdateSort(index, { columnId: opt.value });
                    }}
                  />
                </div>

                <Button
                  kind="tertiary"
                  size="small"
                  leftIcon={sort.direction === 'asc' ? SortAscending : SortDescending}
                  onClick={() =>
                    handleUpdateSort(index, {
                      direction: sort.direction === 'asc' ? 'desc' : 'asc',
                    })
                  }
                  aria-label={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
                >
                  {sort.direction === 'asc' ? 'Asc' : 'Desc'}
                </Button>

                <IconButton
                  aria-label="Remove sort"
                  icon={Delete}
                  size="small"
                  kind="tertiary"
                  onClick={() => handleRemoveSort(index)}
                />
              </div>
            ))}
          </div>
        )}

        <div className={styles.footerActions}>
          <Button kind="tertiary" size="small" leftIcon={Add} onClick={handleAddSort}>
            {sortConditions.length === 0 ? 'Add sort' : 'Add level'}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
