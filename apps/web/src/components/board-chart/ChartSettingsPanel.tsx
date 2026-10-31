import { CHART_GROUP_AXIS, type ChartSettings } from '@atrium/shared';
import { Button, Checkbox } from '@vibe/core';
import { NavigationChevronDown, NavigationChevronRight } from '@vibe/icons';
import { useState, type ReactNode } from 'react';
import { useFilterStore } from '../board-filters';
import type { ColumnView } from '../board-table/table-model';
import {
  CHART_STACK_TYPES,
  CHART_X_TYPES,
  resolveStackDim,
  resolveXDim,
  resolveY,
  type ChartModel,
} from './chart-model';
import styles from './chart.module.css';

const CHART_TYPES: { value: ChartSettings['chartType']; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'stacked_bar', label: 'Stacked bar' },
  { value: 'line', label: 'Line' },
  { value: 'pie', label: 'Pie' },
  { value: 'donut', label: 'Donut' },
];

const Y_MODES: { value: ChartSettings['yMode']; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

const SORTS: { value: ChartSettings['sortBy']; label: string }[] = [
  { value: 'board', label: 'Board order' },
  { value: 'value_desc', label: 'Value, high to low' },
  { value: 'value_asc', label: 'Value, low to high' },
];

const BUCKETS: { value: ChartSettings['dateBucket']; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
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

export interface ChartSettingsPanelProps {
  boardId: string;
  /** Every board column. */
  columns: readonly ColumnView[];
  settings: ChartSettings;
  model: ChartModel;
  onClose: () => void;
}

/**
 * The Chart's settings, as a right-hand side panel: chart type, the X axis, the Y measure, the
 * stack split and what the view shows. Changes are unsaved view changes, saved with "Save to this
 * view" like filters.
 */
export function ChartSettingsPanel({
  boardId,
  columns,
  settings,
  model,
  onClose,
}: ChartSettingsPanelProps) {
  const set = (patch: Partial<ChartSettings>) =>
    useFilterStore.getState().setTypeSettings(boardId, 'chart', patch);

  const xDim = resolveXDim(columns, settings.xColumnId);
  const stackDim = resolveStackDim(columns, settings.stackColumnId, xDim);
  const y = resolveY(columns, settings);
  const numbers = columns.filter((c) => c.def.type === 'numbers');
  const xColumns = columns.filter((c) => (CHART_X_TYPES as readonly string[]).includes(c.def.type));
  const stackColumns = columns.filter(
    (c) => (CHART_STACK_TYPES as readonly string[]).includes(c.def.type) && c.def.id !== xDim.id,
  );
  const isDateAxis = xDim.kind === 'date' || xDim.kind === 'timeline';

  const toggles: { key: 'showLegend' | 'showValues' | 'showEmpty'; label: string }[] = [
    { key: 'showLegend', label: 'Show legend' },
    { key: 'showValues', label: 'Show values' },
    { key: 'showEmpty', label: 'Show empty' },
  ];

  return (
    <aside className={styles.settings} aria-label="Chart settings">
      <div className={styles.settingsHeader}>
        <span className={styles.settingsTitle}>Chart settings</span>
        <Button kind="tertiary" size="small" aria-label="Close chart settings" onClick={onClose}>
          Close
        </Button>
      </div>

      <Section title="Chart type">
        <div className={styles.typeButtons} role="group" aria-label="Chart type">
          {CHART_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              className={styles.typeButton}
              aria-pressed={settings.chartType === type.value}
              onClick={() => set({ chartType: type.value })}
            >
              {type.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="X axis">
        <label className={styles.settingsLabel} htmlFor="chart-x">
          Group items by
        </label>
        <select
          id="chart-x"
          className={styles.select}
          value={xDim.id}
          onChange={(event) => set({ xColumnId: event.target.value })}
        >
          <option value={CHART_GROUP_AXIS}>Group</option>
          {xColumns.map((c) => (
            <option key={c.def.id} value={c.def.id}>
              {c.def.title}
            </option>
          ))}
        </select>
        {isDateAxis ? (
          <>
            <label className={styles.settingsLabel} htmlFor="chart-bucket">
              By
            </label>
            <select
              id="chart-bucket"
              className={styles.select}
              value={settings.dateBucket}
              onChange={(event) =>
                set({ dateBucket: event.target.value as ChartSettings['dateBucket'] })
              }
            >
              {BUCKETS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </Section>

      <Section title="Y axis">
        <div className={styles.modeButtons} role="group" aria-label="Measure">
          {Y_MODES.map((mode) => {
            const unavailable = mode.value !== 'count' && numbers.length === 0;
            return (
              <button
                key={mode.value}
                type="button"
                className={styles.typeButton}
                aria-pressed={y.mode === mode.value}
                disabled={unavailable}
                title={unavailable ? 'Add a Numbers column' : undefined}
                onClick={() => set({ yMode: mode.value })}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        {y.mode !== 'count' || settings.yMode !== 'count' ? (
          <>
            <label className={styles.settingsLabel} htmlFor="chart-y">
              Numbers column
            </label>
            <select
              id="chart-y"
              className={styles.select}
              value={y.column?.def.id ?? ''}
              disabled={numbers.length === 0}
              onChange={(event) => set({ yColumnId: event.target.value })}
            >
              {y.column ? null : <option value="">None</option>}
              {numbers.map((c) => (
                <option key={c.def.id} value={c.def.id}>
                  {c.def.title}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {model.yFallback ? <p className={styles.settingsNote}>{model.yFallback}</p> : null}
      </Section>

      {settings.chartType === 'stacked_bar' ? (
        <Section title="Stack by">
          <label className={styles.settingsLabel} htmlFor="chart-stack">
            Split each bar by
          </label>
          <select
            id="chart-stack"
            className={styles.select}
            value={stackDim?.id ?? ''}
            onChange={(event) => set({ stackColumnId: event.target.value })}
          >
            {stackDim ? null : <option value="">Nothing to split by</option>}
            {xDim.id === CHART_GROUP_AXIS ? null : <option value={CHART_GROUP_AXIS}>Group</option>}
            {stackColumns.map((c) => (
              <option key={c.def.id} value={c.def.id}>
                {c.def.title}
              </option>
            ))}
          </select>
        </Section>
      ) : null}

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
        <label className={styles.settingsLabel} htmlFor="chart-sort">
          Sort
        </label>
        <select
          id="chart-sort"
          className={styles.select}
          value={settings.sortBy}
          onChange={(event) => set({ sortBy: event.target.value as ChartSettings['sortBy'] })}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Section>
    </aside>
  );
}
