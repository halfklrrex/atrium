import { Button, Checkbox } from '@vibe/core';
import { NavigationChevronDown, NavigationChevronRight } from '@vibe/icons';
import { useState, type ReactNode } from 'react';
import type { TimelineViewSettings } from '@atrium/shared';
import { useFilterStore } from '../board-filters';
import { statusColumns } from '../board-date-views/date-view-model';
import type { ColumnView } from '../board-table/table-model';
import styles from './timeline.module.css';

export interface TimelineSettingsPanelProps {
  boardId: string;
  /** The timeline and date columns that can place items. */
  timeColumns: readonly ColumnView[];
  /** Every board column (the status columns among them can colour the items). */
  columns: readonly ColumnView[];
  /** The time column in use (the saved one, or the fallback). */
  columnId: string | null;
  settings: TimelineViewSettings;
  onClose: () => void;
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.settingsSection}>
      <button
        type="button"
        className={styles.settingsSectionHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <NavigationChevronDown aria-hidden="true" />
        ) : (
          <NavigationChevronRight aria-hidden="true" />
        )}
        {title}
      </button>
      {open ? <div className={styles.settingsSectionBody}>{children}</div> : null}
    </section>
  );
}

/**
 * The Timeline's settings, as a right-hand side panel that pushes the timeline narrower: which
 * column places the items, what colours them and what the view shows. Changes are unsaved view
 * changes, saved with "Save to this view" like filters.
 */
export function TimelineSettingsPanel({
  boardId,
  timeColumns,
  columns,
  columnId,
  settings,
  onClose,
}: TimelineSettingsPanelProps) {
  const set = (patch: Partial<TimelineViewSettings>) =>
    useFilterStore.getState().setTypeSettings(boardId, 'timeline', patch);
  const statuses = statusColumns(columns);
  // A saved colour column that is gone shows as "Group".
  const colorBy = statuses.some((c) => c.def.id === settings.colorBy) ? settings.colorBy : null;

  const toggles: {
    key: 'showGroupSummary' | 'showToday' | 'showWeekends' | 'showLegend';
    label: string;
  }[] = [
    { key: 'showGroupSummary', label: 'Show group summary' },
    { key: 'showToday', label: 'Show today indication' },
    { key: 'showWeekends', label: 'Show weekends' },
    { key: 'showLegend', label: 'Show colour legend' },
  ];

  return (
    <aside className={styles.settings} aria-label="Timeline settings">
      <div className={styles.settingsHeader}>
        <span className={styles.settingsTitle}>Timeline settings</span>
        <Button kind="tertiary" size="small" aria-label="Close timeline settings" onClick={onClose}>
          Close
        </Button>
      </div>

      <Section title="Timeline column">
        <label className={styles.settingsLabel} htmlFor="timeline-column">
          Show items by
        </label>
        <select
          id="timeline-column"
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
      </Section>

      <Section title="Colour by">
        <label className={styles.settingsLabel} htmlFor="timeline-color">
          Colour items by
        </label>
        <select
          id="timeline-color"
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
      </Section>

      <Section title="View settings">
        <ul className={styles.settingsToggles}>
          {toggles.map(({ key, label }) => (
            <li key={key}>
              <Checkbox
                checked={settings[key]}
                onChange={() => set({ [key]: !settings[key] })}
                label={label}
              />
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}
