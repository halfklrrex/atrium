import type { GanttSettings } from '@atrium/shared';
import { useFilterStore } from '../board-filters';
import {
  Section,
  TimelineSettingsPanel,
  type TimelineSettingsPanelProps,
} from '../board-timeline/TimelineSettingsPanel';
import timelineStyles from '../board-timeline/timeline.module.css';
import { resolveDependencyColumn } from './gantt-model';

export interface GanttSettingsPanelProps extends Omit<
  TimelineSettingsPanelProps,
  'kind' | 'children'
> {
  gantt: GanttSettings;
}

/** The Timeline settings plus which Dependency column draws the arrows. */
export function GanttSettingsPanel({ gantt, ...panel }: GanttSettingsPanelProps) {
  const dependencyColumns = panel.columns.filter((c) => c.def.type === 'dependency');
  const current = resolveDependencyColumn(panel.columns, gantt.dependencyColumnId);
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
              onChange={(event) =>
                useFilterStore.getState().setTypeSettings(panel.boardId, 'gantt', {
                  dependencyColumnId: event.target.value,
                })
              }
            >
              {dependencyColumns.map((c) => (
                <option key={c.def.id} value={c.def.id}>
                  {c.def.title}
                </option>
              ))}
            </select>
          </>
        )}
      </Section>
    </TimelineSettingsPanel>
  );
}
