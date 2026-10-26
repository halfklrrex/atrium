import type { ColumnDef, GroupDef } from './schemas/board';
import { columnRegistry } from './columns';
import type { StatusLabel, StatusSettings } from './columns';

/** Vibe `--color-bright-blue` / `--color-grass-green` as stored hex values (documents hold hex). */
export const DEFAULT_GROUP_COLORS = ['#579bfc', '#037f4c'] as const;

/**
 * monday's default status labels: orange "Working on it", green "Done", red "Stuck" and the grey
 * empty/default label (index 5, as in monday). Label ids use monday's colour names.
 */
export const DEFAULT_BOARD_STATUS_LABELS: readonly StatusLabel[] = [
  { id: 'working_orange', index: 0, label: 'Working on it', color: '#fdab3d' },
  { id: 'done_green', index: 1, label: 'Done', color: '#00c875', isDone: true },
  { id: 'stuck_red', index: 2, label: 'Stuck', color: '#df2f4a' },
  { id: 'default_grey', index: 5, label: '', color: '#c4c4c4' },
];

export interface BoardStructure {
  columns: ColumnDef[];
  subitemColumns: ColumnDef[];
  groups: GroupDef[];
  itemTerminology: string;
}

/**
 * Structure of a brand new board (P1a spec section 1): Person, Status and Date columns and two
 * "Group Title" groups. `newId` supplies the group slug ids so callers control randomness (and tests
 * stay deterministic).
 */
export function defaultBoardStructure(newId: () => string): BoardStructure {
  const statusSettings: StatusSettings = {
    labels: DEFAULT_BOARD_STATUS_LABELS.map((label) => ({ ...label })),
  };
  return {
    columns: [
      {
        id: 'person',
        type: 'people',
        title: 'Person',
        position: 'a0',
        settings: columnRegistry.defaultSettings('people') as Record<string, unknown>,
      },
      {
        id: 'status',
        type: 'status',
        title: 'Status',
        position: 'a1',
        settings: statusSettings,
      },
      {
        id: 'date',
        type: 'date',
        title: 'Date',
        position: 'a2',
        settings: columnRegistry.defaultSettings('date') as Record<string, unknown>,
      },
    ],
    subitemColumns: [],
    groups: DEFAULT_GROUP_COLORS.map((color, i) => ({
      id: newId(),
      title: 'Group Title',
      color,
      position: `a${i}`,
    })),
    itemTerminology: 'item',
  };
}

/** Name for a duplicated board, e.g. "Roadmap (copy)", kept within the 120 character limit. */
export function duplicateBoardName(name: string): string {
  const suffix = ' (copy)';
  return `${name.slice(0, 120 - suffix.length)}${suffix}`;
}
