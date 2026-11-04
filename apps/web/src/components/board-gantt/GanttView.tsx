import type { BoardDoc } from '../../data';
import { useViewTypeSettings } from '../board-filters';
import { TimelineView } from '../board-timeline/TimelineView';
import { GanttArrows } from './GanttArrows';
import { GanttSettingsPanel } from './GanttSettingsPanel';
import { resolveDependencyColumn } from './gantt-model';

export interface GanttViewProps {
  board: BoardDoc;
}

/**
 * The Gantt view: the Timeline (same axis, zoom, lanes, bars and drags) with arrows between
 * dependent items drawn over the lanes, and the Gantt's own settings.
 */
export function GanttView({ board }: GanttViewProps) {
  const settings = useViewTypeSettings(board.id, 'gantt');
  return (
    <TimelineView
      board={board}
      kind="gantt"
      renderOverlay={({ model, windows, columns }) => (
        <GanttArrows
          model={model}
          windows={windows}
          dependencyColumnId={
            resolveDependencyColumn(columns, settings.dependencyColumnId)?.def.id ?? null
          }
        />
      )}
      renderSettings={(panel) => <GanttSettingsPanel {...panel} gantt={settings} />}
    />
  );
}
