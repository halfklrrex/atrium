import { WORKLOAD_MAX_CAPACITY, type WorkloadSettings } from '@atrium/shared';
import { Button, Checkbox } from '@vibe/core';
import { useFilterStore } from '../board-filters';
import type { ColumnView } from '../board-table/table-model';
import { Section } from '../board-timeline/TimelineSettingsPanel';
import tl from '../board-timeline/timeline.module.css';
import { DEFAULT_CAPACITY, type WorkloadColumns, type WorkloadMeasure } from './workload-model';

export interface WorkloadSettingsPanelProps {
  boardId: string;
  /** Every board column. */
  columns: readonly ColumnView[];
  /** The columns the settings resolve to now (the saved ones, or the fallbacks). */
  resolved: WorkloadColumns;
  /** The measure in use (`count` when `sum` has no Numbers column). */
  measure: WorkloadMeasure;
  settings: WorkloadSettings;
  onClose: () => void;
}

/**
 * The Workload's settings, as a right-hand side panel: which date or timeline column places the
 * items, which People column makes the rows, what the cells measure and the capacity per person
 * per day. Changes are unsaved view changes, saved with "Save to this view" like filters.
 */
export function WorkloadSettingsPanel({
  boardId,
  columns,
  resolved,
  measure,
  settings,
  onClose,
}: WorkloadSettingsPanelProps) {
  const set = (patch: Partial<WorkloadSettings>) =>
    useFilterStore.getState().setTypeSettings(boardId, 'workload', patch);
  const of = (...types: string[]) => columns.filter((c) => types.includes(c.def.type));
  const timeColumns = of('timeline', 'date');
  const peopleColumns = of('people');
  const numberColumns = of('numbers');

  const toggles: { key: 'showToday' | 'showWeekends'; label: string }[] = [
    { key: 'showToday', label: 'Show today indication' },
    { key: 'showWeekends', label: 'Show weekends' },
  ];

  return (
    <aside className={tl.settings} aria-label="Workload settings">
      <div className={tl.settingsHeader}>
        <span className={tl.settingsTitle}>Workload settings</span>
        <Button kind="tertiary" size="small" aria-label="Close workload settings" onClick={onClose}>
          Close
        </Button>
      </div>

      <Section title="Timeline column">
        <label className={tl.settingsLabel} htmlFor="workload-column">
          Show items by
        </label>
        <select
          id="workload-column"
          className={tl.select}
          value={resolved.dateColumn?.def.id ?? ''}
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

      <Section title="People column">
        {peopleColumns.length === 0 ? (
          <p className={tl.settingsLabel}>
            Add a People column to the board to see the work of each person. Until then every item
            is listed as unassigned.
          </p>
        ) : (
          <>
            <label className={tl.settingsLabel} htmlFor="workload-people">
              One row per person in
            </label>
            <select
              id="workload-people"
              className={tl.select}
              value={resolved.peopleColumn?.def.id ?? ''}
              onChange={(event) => set({ peopleColumnId: event.target.value })}
            >
              {peopleColumns.map((c) => (
                <option key={c.def.id} value={c.def.id}>
                  {c.def.title}
                </option>
              ))}
            </select>
          </>
        )}
      </Section>

      <Section title="Measure">
        <label className={tl.settingsLabel} htmlFor="workload-measure">
          Cells show
        </label>
        <select
          id="workload-measure"
          className={tl.select}
          value={settings.measure}
          onChange={(event) => set({ measure: event.target.value === 'sum' ? 'sum' : 'count' })}
        >
          <option value="count">Number of items</option>
          <option value="sum" disabled={numberColumns.length === 0}>
            Sum of a Numbers column
          </option>
        </select>
        {settings.measure === 'sum' ? (
          numberColumns.length === 0 ? (
            <p className={tl.settingsLabel}>
              Add a Numbers column (for example an estimate in hours) to sum it. Until then the
              cells count items.
            </p>
          ) : (
            <>
              <label className={tl.settingsLabel} htmlFor="workload-sum">
                Add up
              </label>
              <select
                id="workload-sum"
                className={tl.select}
                value={resolved.sumColumn?.def.id ?? ''}
                onChange={(event) => set({ sumColumnId: event.target.value })}
              >
                {numberColumns.map((c) => (
                  <option key={c.def.id} value={c.def.id}>
                    {c.def.title}
                  </option>
                ))}
              </select>
            </>
          )
        ) : null}
      </Section>

      <Section title="Capacity">
        <label className={tl.settingsLabel} htmlFor="workload-capacity">
          Capacity per person per day
        </label>
        <input
          id="workload-capacity"
          key={measure}
          className={tl.select}
          type="number"
          min={0}
          step="any"
          placeholder={String(DEFAULT_CAPACITY[measure])}
          defaultValue={settings.capacityPerDay ?? ''}
          onChange={(event) => {
            const n = event.target.valueAsNumber;
            if (event.target.value === '') set({ capacityPerDay: null });
            else if (Number.isFinite(n) && n > 0)
              set({ capacityPerDay: Math.min(n, WORKLOAD_MAX_CAPACITY) });
          }}
        />
        <p className={tl.settingsLabel}>
          A cell is light below 60% of the capacity, balanced up to 100% and over beyond it.
        </p>
      </Section>

      <Section title="View settings">
        <ul className={tl.settingsToggles}>
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
