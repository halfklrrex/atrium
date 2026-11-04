import { Button } from '@vibe/core';
import { useMemo } from 'react';
import type { BoardDoc } from '../../data';
import { useFilterStore, useViewTypeSettings } from '../board-filters';
import { buildColumnViews } from '../board-table/table-model';
import { TimelineView } from '../board-timeline/TimelineView';
import { resolveTimelineColumn } from '../board-timeline/timeline-model';
import { GanttArrows } from './GanttArrows';
import { GanttBaselines } from './GanttBaselines';
import { GanttSettingsPanel } from './GanttSettingsPanel';
import { resolveBaselineColumn, resolveDependencyColumn } from './gantt-model';

export interface GanttViewProps {
  board: BoardDoc;
}

/**
 * The Gantt view: the Timeline (same axis, zoom, lanes, bars and drags) with arrows between
 * dependent items drawn over the lanes, an optional baseline under each bar, an optional critical
 * path highlight, and the Gantt's own settings.
 */
export function GanttView({ board }: GanttViewProps) {
  const settings = useViewTypeSettings(board.id, 'gantt');
  const columns = useMemo(() => buildColumnViews(board.columns), [board.columns]);
  const barColumnId = resolveTimelineColumn(columns, settings.columnId)?.def.id ?? null;
  const baselineColumn = resolveBaselineColumn(columns, settings.baselineColumnId, barColumnId);
  const dependencyColumn = resolveDependencyColumn(columns, settings.dependencyColumnId);
  const set = (patch: { showBaseline?: boolean; showCriticalPath?: boolean }) =>
    useFilterStore.getState().setTypeSettings(board.id, 'gantt', patch);
  return (
    <TimelineView
      board={board}
      kind="gantt"
      extraControls={
        <>
          {baselineColumn ? (
            <Button
              kind={settings.showBaseline ? 'primary' : 'secondary'}
              size="small"
              aria-pressed={settings.showBaseline}
              onClick={() => set({ showBaseline: !settings.showBaseline })}
            >
              Baseline
            </Button>
          ) : null}
          {dependencyColumn ? (
            <Button
              kind={settings.showCriticalPath ? 'primary' : 'secondary'}
              size="small"
              aria-pressed={settings.showCriticalPath}
              onClick={() => set({ showCriticalPath: !settings.showCriticalPath })}
            >
              Critical path
            </Button>
          ) : null}
        </>
      }
      renderOverlay={({ model, windows }) => (
        <>
          {baselineColumn && settings.showBaseline ? (
            <GanttBaselines model={model} windows={windows} column={baselineColumn} />
          ) : null}
          <GanttArrows
            model={model}
            windows={windows}
            dependencyColumnId={dependencyColumn?.def.id ?? null}
            showCriticalPath={settings.showCriticalPath}
          />
        </>
      )}
      renderSettings={(panel) => <GanttSettingsPanel {...panel} gantt={settings} />}
    />
  );
}
