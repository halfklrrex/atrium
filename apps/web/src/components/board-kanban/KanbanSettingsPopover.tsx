import { Button, Checkbox, Icon } from '@vibe/core';
import { NavigationChevronDown, NavigationChevronUp, Settings } from '@vibe/icons';
import { useState } from 'react';
import { getColumnUi } from '../../columns/registry';
import type { KanbanSettings } from '@atrium/shared';
import { useFilterStore } from '../board-filters';
import filters from '../board-filters/board-filters.module.css';
import { Popover } from '../Popover';
import type { ColumnView } from '../board-table/table-model';
import styles from './kanban.module.css';

export interface KanbanSettingsPopoverProps {
  boardId: string;
  /** Every board column, in order. */
  columns: readonly ColumnView[];
  /** The status column the lanes come from. */
  statusColumnId: string | null;
  /** The columns the cards show now, in order. */
  cardColumns: readonly ColumnView[];
  settings: KanbanSettings;
}

/**
 * The gear in a Kanban view's toolbar: which status column makes the lanes, which columns the
 * cards show (and in what order), and whether empty lanes show. Changes are unsaved view changes,
 * saved with "Save to this view" like filters.
 */
export function KanbanSettingsPopover({
  boardId,
  columns,
  statusColumnId,
  cardColumns,
  settings,
}: KanbanSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const store = useFilterStore.getState();
  const statuses = columns.filter((c) => c.def.type === 'status');
  const shownIds = cardColumns.map((c) => c.def.id);
  const rest = columns.filter((c) => !shownIds.includes(c.def.id));

  const setFields = (ids: string[]) => store.setKanban(boardId, { cardColumnIds: ids });
  const move = (id: string, by: -1 | 1) => {
    const at = shownIds.indexOf(id);
    const to = at + by;
    if (at === -1 || to < 0 || to >= shownIds.length) return;
    const next = [...shownIds];
    [next[at], next[to]] = [next[to]!, next[at]!];
    setFields(next);
  };
  const toggle = (id: string, on: boolean) =>
    setFields(on ? [...shownIds, id] : shownIds.filter((x) => x !== id));

  const row = (column: ColumnView, checked: boolean) => {
    const ColumnIcon = getColumnUi(column.def.type)?.icon;
    const index = shownIds.indexOf(column.def.id);
    return (
      <li key={column.def.id} className={styles.fieldRow}>
        <Checkbox
          checked={checked}
          onChange={() => toggle(column.def.id, !checked)}
          aria-label={column.def.title}
          label={
            <span className={styles.fieldRowLabel}>
              {ColumnIcon ? <Icon icon={ColumnIcon} size={16} /> : null}
              <span>{column.def.title}</span>
            </span>
          }
        />
        {checked ? (
          <span className={styles.reorder}>
            <Button
              kind="tertiary"
              size="xxs"
              aria-label={`Move ${column.def.title} up`}
              disabled={index === 0}
              onClick={() => move(column.def.id, -1)}
            >
              <NavigationChevronUp aria-hidden="true" />
            </Button>
            <Button
              kind="tertiary"
              size="xxs"
              aria-label={`Move ${column.def.title} down`}
              disabled={index === shownIds.length - 1}
              onClick={() => move(column.def.id, 1)}
            >
              <NavigationChevronDown aria-hidden="true" />
            </Button>
          </span>
        ) : null}
      </li>
    );
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Kanban settings"
      align="end"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          aria-label="Kanban settings"
          onClick={() => setOpen((v) => !v)}
        >
          <Settings aria-hidden="true" />
        </Button>
      }
    >
      <div className={`${filters.popoverPanel} ${styles.settingsPanel}`}>
        <div className={filters.popoverHeader}>
          <span className={filters.popoverTitle}>Kanban settings</span>
        </div>

        <label className={styles.settingsLabel} htmlFor="kanban-group-by">
          Group cards by
        </label>
        <select
          id="kanban-group-by"
          className={styles.select}
          value={statusColumnId ?? ''}
          disabled={statuses.length === 0}
          onChange={(event) => store.setKanban(boardId, { columnId: event.target.value })}
        >
          {statuses.map((c) => (
            <option key={c.def.id} value={c.def.id}>
              {c.def.title}
            </option>
          ))}
        </select>

        <span className={styles.settingsLabel} id="kanban-fields-label">
          Card fields
        </span>
        <ul className={styles.fieldList} aria-labelledby="kanban-fields-label">
          {cardColumns.map((c) => row(c, true))}
          {rest.map((c) => row(c, false))}
        </ul>

        <div className={styles.settingsFooter}>
          <Checkbox
            checked={settings.showEmptyLanes}
            onChange={() => store.setKanban(boardId, { showEmptyLanes: !settings.showEmptyLanes })}
            label="Show empty lanes"
          />
        </div>
      </div>
    </Popover>
  );
}
