import type { GanttSettings } from '@atrium/shared';
import { Checkbox } from '@vibe/core';
import { useItems } from '../../data';
import { useFilterStore } from '../board-filters';
import {
  Section,
  TimelineSettingsPanel,
  type TimelineSettingsPanelProps,
} from '../board-timeline/TimelineSettingsPanel';
import timelineStyles from '../board-timeline/timeline.module.css';
import styles from './gantt.module.css';
import { TIMELINE_COLUMN_TYPES } from '../board-timeline/timeline-model';
import { hasDependencyLoop, resolveBaselineColumn, resolveDependencyColumn } from './gantt-model';

export interface GanttSettingsPanelProps extends Omit<
  TimelineSettingsPanelProps,
  'kind' | 'children'
> {
  gantt: GanttSettings;
}

/** The Timeline settings plus the Dependency column, the baseline and the critical path. */
export function GanttSettingsPanel({ gantt, ...panel }: GanttSettingsPanelProps) {
  const dependencyColumns = panel.columns.filter((c) => c.def.type === 'dependency');
  const current = resolveDependencyColumn(panel.columns, gantt.dependencyColumnId);
  const set = (patch: Partial<GanttSettings>) =>
    useFilterStore.getState().setTypeSettings(panel.boardId, 'gantt', patch);
  const baselineChoices = panel.timeColumns.filter(
    (c) =>
      (TIMELINE_COLUMN_TYPES as readonly string[]).includes(c.def.type) &&
      c.def.id !== panel.columnId,
  );
  const baseline = resolveBaselineColumn(panel.columns, gantt.baselineColumnId, panel.columnId);
  const { data: items } = useItems(panel.boardId);
  const currentId = current?.def.id ?? null;
  const cyclic = currentId ? hasDependencyLoop(items, currentId) : false;
  return (
    <TimelineSettingsPanel {...panel} kind="gantt">
      <Section title="Dependencies">
        {dependencyColumns.length === 0 ? (
          <p className={timelineStyles.settingsLabel}>
            Add a Dependency column to the board to draw arrows between items that wait for each
            other.
          </p>
        ) : (
          <>
            <label className={timelineStyles.settingsLabel} htmlFor="gantt-dependency">
              Draw arrows from
            </label>
            <select
              id="gantt-dependency"
              className={timelineStyles.select}
              value={current?.def.id ?? ''}
              onChange={(event) => set({ dependencyColumnId: event.target.value })}
            >
              {dependencyColumns.map((c) => (
                <option key={c.def.id} value={c.def.id}>
                  {c.def.title}
                </option>
              ))}
            </select>
            <div className={styles.settingsGap}>
              <Checkbox
                checked={gantt.showCriticalPath}
                onChange={() => set({ showCriticalPath: !gantt.showCriticalPath })}
                label="Show critical path"
              />
            </div>
            {gantt.showCriticalPath && cyclic ? (
              <p className={timelineStyles.settingsLabel} role="status">
                These dependencies form a loop, so the critical path can&apos;t be worked out.
                Remove one of the links in the loop.
              </p>
            ) : null}
          </>
        )}
      </Section>
      <Section title="Baseline">
        {baselineChoices.length === 0 ? (
          <p className={timelineStyles.settingsLabel}>
            Add a second Timeline or Date column to the board to compare the planned dates with the
            current ones.
          </p>
        ) : (
          <>
            <label className={timelineStyles.settingsLabel} htmlFor="gantt-baseline">
              Planned dates in
            </label>
            <select
              id="gantt-baseline"
              className={timelineStyles.select}
              value={baseline?.def.id ?? ''}
              onChange={(event) => set({ baselineColumnId: event.target.value || null })}
            >
              <option value="">None</option>
              {baselineChoices.map((c) => (
                <option key={c.def.id} value={c.def.id}>
                  {c.def.title}
                </option>
              ))}
            </select>
            <div className={styles.settingsGap}>
              <Checkbox
                checked={gantt.showBaseline}
                disabled={!baseline}
                onChange={() => set({ showBaseline: !gantt.showBaseline })}
                label="Show baseline"
              />
            </div>
          </>
        )}
      </Section>
    </TimelineSettingsPanel>
  );
}
