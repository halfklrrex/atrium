import { useMemo, type CSSProperties } from 'react';
import type { LaneWindow, TimelineModel } from '../board-timeline/timeline-model';
import type { ColumnView } from '../board-table/table-model';
import { buildBaselines, visibleBaselines } from './gantt-model';
import styles from './gantt.module.css';

export interface GanttBaselinesProps {
  model: TimelineModel;
  windows: readonly LaneWindow[];
  /** The baseline column (a Timeline or Date column other than the bar column). */
  column: ColumnView;
}

/** The baseline: a thin muted bar under each item's main bar, at the dates in the baseline column. */
export function GanttBaselines({ model, windows, column }: GanttBaselinesProps) {
  const baselines = useMemo(() => buildBaselines(model, column), [model, column]);
  const shown = useMemo(() => visibleBaselines(baselines, windows), [baselines, windows]);
  return (
    <div className={styles.baselines} aria-hidden="true" data-gantt-baselines={shown.length}>
      {shown.map((b) => (
        <div
          key={b.id}
          className={styles.baseline}
          data-baseline={b.id}
          data-baseline-range={`${b.from}/${b.to}`}
          style={
            {
              '--tl-start': b.startIdx,
              '--tl-span': b.endIdx - b.startIdx + 1,
              '--tl-row': b.row,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
