import {
  CHART_GROUP_AXIS,
  DASHBOARD_LIMITS,
  columnRegistry,
  type ChartSettings,
} from '@atrium/shared';
import { Checkbox } from '@vibe/core';
import type { BoardDoc } from '../../data';
import { CHART_STACK_TYPES, CHART_X_TYPES } from '../board-chart/chart-model';
import dialogStyles from '../dialogs/dialogs.module.css';
import styles from './dashboard.module.css';
import type { TableSettings } from './widgets/table-model';
import type { WorkloadWidgetSettings } from './widgets/workload-widget-model';
import {
  columnOptions,
  isNumericColumn,
  isStatusColumn,
  statusLabelsOf,
} from './widgets/widget-columns';

const toggleIn = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/** Checklist that limits a widget to some of the dashboard's boards (none checked = all). */
export function BoardSubsetField({
  boards,
  value,
  onChange,
}: {
  boards: readonly BoardDoc[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className={styles.field}>
      <span className={dialogStyles.fieldLabel}>Boards</span>
      <ul className={styles.checkList} aria-label="Widget boards">
        {boards.map((board) => (
          <li key={board.id}>
            <Checkbox
              label={board.name}
              checked={value.includes(board.id)}
              onChange={() => onChange(toggleIn(value, board.id))}
            />
          </li>
        ))}
      </ul>
      <span className={dialogStyles.hint}>
        {value.length === 0 ? 'All of the dashboard boards.' : `${value.length} selected.`}
      </span>
    </div>
  );
}

const CHART_TYPE_LABELS: Record<ChartSettings['chartType'], string> = {
  bar: 'Bar',
  stacked_bar: 'Stacked bar',
  line: 'Line',
  pie: 'Pie',
  donut: 'Donut',
};
const MEASURE_LABELS: Record<ChartSettings['yMode'], string> = {
  count: 'Count of items',
  sum: 'Sum',
  average: 'Average',
  min: 'Minimum',
  max: 'Maximum',
};
const SORT_LABELS: Record<ChartSettings['sortBy'], string> = {
  board: 'Board order',
  value_desc: 'Largest first',
  value_asc: 'Smallest first',
};

export function ChartSettingsForm({
  boards,
  settings,
  onChange,
}: {
  boards: readonly BoardDoc[];
  settings: ChartSettings;
  onChange: (next: ChartSettings) => void;
}) {
  const xColumns = columnOptions(boards, (d) => CHART_X_TYPES.some((t) => t === d.type));
  const stackColumns = columnOptions(boards, (d) => CHART_STACK_TYPES.some((t) => t === d.type));
  const numberColumns = columnOptions(boards, isNumericColumn);
  const xType = xColumns.find((c) => c.id === settings.xColumnId)?.type;
  const isDate = xType === 'date' || xType === 'timeline';
  const set = (patch: Partial<ChartSettings>) => onChange({ ...settings, ...patch });

  return (
    <>
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Chart type</span>
        <select
          className={styles.select}
          aria-label="Chart type"
          value={settings.chartType}
          onChange={(e) => set({ chartType: e.target.value as ChartSettings['chartType'] })}
        >
          {(Object.keys(CHART_TYPE_LABELS) as ChartSettings['chartType'][]).map((t) => (
            <option key={t} value={t}>
              {CHART_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>X axis</span>
        <select
          className={styles.select}
          aria-label="X axis"
          value={settings.xColumnId ?? ''}
          onChange={(e) => set({ xColumnId: e.target.value || null })}
        >
          <option value="">First status column</option>
          <option value={CHART_GROUP_AXIS}>Group</option>
          {xColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {isDate ? (
        <label className={styles.field}>
          <span className={dialogStyles.fieldLabel}>Group dates by</span>
          <select
            className={styles.select}
            aria-label="Group dates by"
            value={settings.dateBucket}
            onChange={(e) => set({ dateBucket: e.target.value as ChartSettings['dateBucket'] })}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      ) : null}
      {settings.chartType === 'stacked_bar' ? (
        <label className={styles.field}>
          <span className={dialogStyles.fieldLabel}>Stack by</span>
          <select
            className={styles.select}
            aria-label="Stack by"
            value={settings.stackColumnId ?? ''}
            onChange={(e) => set({ stackColumnId: e.target.value || null })}
          >
            <option value="">Another status column</option>
            <option value={CHART_GROUP_AXIS}>Group</option>
            {stackColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Measure</span>
        <select
          className={styles.select}
          aria-label="Measure"
          value={settings.yMode}
          onChange={(e) => {
            const yMode = e.target.value as ChartSettings['yMode'];
            set({ yMode, yColumnId: yMode === 'count' ? null : settings.yColumnId });
          }}
        >
          {(Object.keys(MEASURE_LABELS) as ChartSettings['yMode'][]).map((m) => (
            <option key={m} value={m}>
              {MEASURE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {settings.yMode !== 'count' ? (
        <label className={styles.field}>
          <span className={dialogStyles.fieldLabel}>Column</span>
          <select
            className={styles.select}
            aria-label="Measure column"
            value={settings.yColumnId ?? ''}
            onChange={(e) => set({ yColumnId: e.target.value || null })}
          >
            <option value="">First number column</option>
            {numberColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {numberColumns.length === 0 ? (
            <span className={dialogStyles.hint}>
              None of the boards has a Numbers, Progress or number Formula column, so the chart
              counts items.
            </span>
          ) : null}
        </label>
      ) : null}
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Sort</span>
        <select
          className={styles.select}
          aria-label="Sort"
          value={settings.sortBy}
          onChange={(e) => set({ sortBy: e.target.value as ChartSettings['sortBy'] })}
        >
          {(Object.keys(SORT_LABELS) as ChartSettings['sortBy'][]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <ul className={styles.checkList} aria-label="Chart options">
        <li>
          <Checkbox
            label="Show legend"
            checked={settings.showLegend}
            onChange={() => set({ showLegend: !settings.showLegend })}
          />
        </li>
        <li>
          <Checkbox
            label="Show values"
            checked={settings.showValues}
            onChange={() => set({ showValues: !settings.showValues })}
          />
        </li>
        <li>
          <Checkbox
            label="Show empty values"
            checked={settings.showEmpty}
            onChange={() => set({ showEmpty: !settings.showEmpty })}
          />
        </li>
      </ul>
    </>
  );
}

export function TableSettingsForm({
  boards,
  settings,
  onChange,
}: {
  boards: readonly BoardDoc[];
  settings: TableSettings;
  onChange: (next: TableSettings) => void;
}) {
  const options = columnOptions(boards, (d) => columnRegistry.has(d.type));
  const statusColumns = columnOptions(boards, isStatusColumn);
  const filterLabels = statusLabelsOf(boards, settings.filter?.columnId ?? null);
  const atLimit = settings.columnIds.length >= DASHBOARD_LIMITS.tableColumns;

  return (
    <>
      <div className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Columns</span>
        <ul className={styles.checkList} aria-label="Table columns">
          {options.map((c) => {
            const checked = settings.columnIds.includes(c.id);
            return (
              <li key={c.id}>
                <Checkbox
                  label={c.title}
                  checked={checked}
                  disabled={!checked && atLimit}
                  onChange={() =>
                    onChange({ ...settings, columnIds: toggleIn(settings.columnIds, c.id) })
                  }
                />
              </li>
            );
          })}
        </ul>
        <span className={dialogStyles.hint}>
          {settings.columnIds.length === 0
            ? 'Shows Status, People and Date.'
            : `${settings.columnIds.length} of ${DASHBOARD_LIMITS.tableColumns} columns.`}
        </span>
      </div>
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Only items with status in</span>
        <select
          className={styles.select}
          aria-label="Filter by status column"
          value={settings.filter?.columnId ?? ''}
          onChange={(e) =>
            onChange({
              ...settings,
              filter: e.target.value ? { columnId: e.target.value, values: [] } : null,
            })
          }
        >
          <option value="">All items</option>
          {statusColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {settings.filter ? (
        <ul className={styles.checkList} aria-label="Status labels">
          {filterLabels.map((label) => (
            <li key={label.id}>
              <Checkbox
                label={label.label}
                checked={settings.filter?.values.includes(label.id) ?? false}
                onChange={() =>
                  settings.filter &&
                  onChange({
                    ...settings,
                    filter: {
                      ...settings.filter,
                      values: toggleIn(settings.filter.values, label.id),
                    },
                  })
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Rows</span>
        <select
          className={styles.select}
          aria-label="Row limit"
          value={settings.rowLimit}
          onChange={(e) =>
            onChange({ ...settings, rowLimit: Number(e.target.value) as TableSettings['rowLimit'] })
          }
        >
          {[10, 25, 50].map((n) => (
            <option key={n} value={n}>
              Up to {n}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function WorkloadSettingsForm({
  boards,
  settings,
  onChange,
}: {
  boards: readonly BoardDoc[];
  settings: WorkloadWidgetSettings;
  onChange: (next: WorkloadWidgetSettings) => void;
}) {
  const people = columnOptions(boards, (d) => d.type === 'people');
  const dates = columnOptions(boards, (d) => d.type === 'timeline' || d.type === 'date');
  return (
    <>
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>People column</span>
        <select
          className={styles.select}
          aria-label="People column"
          value={settings.peopleColumnId ?? ''}
          onChange={(e) => onChange({ ...settings, peopleColumnId: e.target.value || null })}
        >
          <option value="">First People column of each board</option>
          {people.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Date column</span>
        <select
          className={styles.select}
          aria-label="Date column"
          value={settings.dateColumnId ?? ''}
          onChange={(e) => onChange({ ...settings, dateColumnId: e.target.value || null })}
        >
          <option value="">First Timeline or Date column of each board</option>
          {dates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={dialogStyles.fieldLabel}>Period</span>
        <select
          className={styles.select}
          aria-label="Period"
          value={settings.bucket}
          onChange={(e) =>
            onChange({ ...settings, bucket: e.target.value === 'month' ? 'month' : 'week' })
          }
        >
          <option value="week">Weeks</option>
          <option value="month">Months</option>
        </select>
      </label>
    </>
  );
}
