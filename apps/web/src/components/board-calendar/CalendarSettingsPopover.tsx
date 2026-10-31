import { Button, Checkbox } from '@vibe/core';
import { Settings } from '@vibe/icons';
import { useState } from 'react';
import type { CalendarSettings } from '@atrium/shared';
import { useFilterStore } from '../board-filters';
import filters from '../board-filters/board-filters.module.css';
import { Popover } from '../Popover';
import type { ColumnView } from '../board-table/table-model';
import { statusColumns } from './calendar-model';
import styles from './calendar.module.css';

export interface CalendarSettingsPopoverProps {
  boardId: string;
  /** The date and timeline columns that can place items. */
  timeColumns: readonly ColumnView[];
  /** Every board column (the status columns among them can colour the items). */
  columns: readonly ColumnView[];
  /** The time column in use (the saved one, or the fallback). */
  columnId: string | null;
  settings: CalendarSettings;
}

/**
 * The gear in a Calendar view's toolbar: which date or timeline column places the items, what
 * colours them, whether weekends show and which day the week starts on. Changes are unsaved view
 * changes, saved with "Save to this view" like filters.
 */
export function CalendarSettingsPopover({
  boardId,
  timeColumns,
  columns,
  columnId,
  settings,
}: CalendarSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<CalendarSettings>) =>
    useFilterStore.getState().setTypeSettings(boardId, 'calendar', patch);
  const statuses = statusColumns(columns);
  // A saved colour column that is gone shows as "Group".
  const colorBy = statuses.some((c) => c.def.id === settings.colorBy) ? settings.colorBy : null;

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Calendar settings"
      align="end"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          aria-label="Calendar settings"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Settings aria-hidden="true" />
        </Button>
      }
    >
      <div className={`${filters.popoverPanel} ${styles.settingsPanel}`}>
        <div className={filters.popoverHeader}>
          <span className={filters.popoverTitle}>Calendar settings</span>
        </div>

        <label className={styles.settingsLabel} htmlFor="calendar-column">
          Show items by
        </label>
        <select
          id="calendar-column"
          className={styles.select}
          value={columnId ?? ''}
          disabled={timeColumns.length === 0}
          onChange={(event) => set({ columnId: event.target.value })}
        >
          {timeColumns.map((c) => (
            <option key={c.def.id} value={c.def.id}>
              {c.def.title}
            </option>
          ))}
        </select>

        <label className={styles.settingsLabel} htmlFor="calendar-color">
          Colour by
        </label>
        <select
          id="calendar-color"
          className={styles.select}
          value={colorBy ?? ''}
          onChange={(event) => set({ colorBy: event.target.value || null })}
        >
          <option value="">Group</option>
          {statuses.map((c) => (
            <option key={c.def.id} value={c.def.id}>
              {c.def.title}
            </option>
          ))}
        </select>

        <label className={styles.settingsLabel} htmlFor="calendar-first-day">
          Week starts on
        </label>
        <select
          id="calendar-first-day"
          className={styles.select}
          value={settings.firstDayOfWeek}
          onChange={(event) =>
            set({ firstDayOfWeek: event.target.value === 'sunday' ? 'sunday' : 'monday' })
          }
        >
          <option value="monday">Monday</option>
          <option value="sunday">Sunday</option>
        </select>

        <div className={styles.settingsFooter}>
          <Checkbox
            checked={settings.showWeekends}
            onChange={() => set({ showWeekends: !settings.showWeekends })}
            label="Show weekends"
          />
        </div>
      </div>
    </Popover>
  );
}
