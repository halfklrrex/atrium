import { columnRegistry } from '@atrium/shared';
import { autoNumberUi } from './auto-number';
import { boardRelationUi } from './board-relation';
import { buttonUi } from './button';
import { checkboxUi } from './checkbox';
import { colorUi } from './color';
import { countryUi } from './country';
import { creationLogUi } from './creation-log';
import { dateUi } from './date';
import { dependencyUi } from './dependency';
import { dropdownUi } from './dropdown';
import { emailUi } from './email';
import { filesUi } from './files';
import { formulaUi } from './formula';
import { hourUi } from './hour';
import { itemIdUi } from './item-id';
import { lastUpdatedUi } from './last-updated';
import { linkUi } from './link';
import { locationUi } from './location';
import { longTextUi } from './long-text';
import { mirrorUi } from './mirror';
import { numbersUi } from './numbers';
import { peopleUi } from './people';
import { phoneUi } from './phone';
import { progressUi } from './progress';
import { ratingUi } from './rating';
import { statusUi } from './status';
import { tagsUi } from './tags';
import { textUi } from './text';
import { timeTrackingUi } from './time-tracking';
import { timelineUi } from './timeline';
import type { AnyColumnUi } from './types';
import { voteUi } from './vote';
import { weekUi } from './week';
import { worldClockUi } from './world-clock';

export type { AnyColumnUi, CellContext, CellProps, EditorProps, ColumnUi, TileTone } from './types';
export { defineColumnUi } from './types';

/** The web half of every column type, keyed by `ColumnDef.type` (shared half: `columnRegistry`). */
const uis = new Map<string, AnyColumnUi>();

/** Register how a column type is drawn and edited. Throws on a duplicate. */
export function registerColumnUi(ui: AnyColumnUi): void {
  if (uis.has(ui.type)) throw new Error(`Column UI "${ui.type}" is already registered`);
  uis.set(ui.type, ui);
}

[
  statusUi,
  textUi,
  longTextUi,
  numbersUi,
  dateUi,
  peopleUi,
  dropdownUi,
  checkboxUi,
  linkUi,
  ratingUi,
  voteUi,
  colorUi,
  countryUi,
  emailUi,
  phoneUi,
  tagsUi,
  progressUi,
  autoNumberUi,
  itemIdUi,
  creationLogUi,
  lastUpdatedUi,
  timelineUi,
  weekUi,
  hourUi,
  worldClockUi,
  locationUi,
  filesUi,
  buttonUi,
  timeTrackingUi,
  formulaUi,
  dependencyUi,
  boardRelationUi,
  mirrorUi,
].forEach(registerColumnUi);

export function getColumnUi(type: string): AnyColumnUi | undefined {
  return uis.get(type);
}

const ADD_COLUMN_TYPES = [
  'status',
  'text',
  'people',
  'date',
  'numbers',
  'dropdown',
  'checkbox',
  'link',
  'long_text',
  'rating',
  'vote',
  'color_picker',
  'country',
  'email',
  'phone',
  'tags',
  'progress',
  'auto_number',
  'item_id',
  'creation_log',
  'last_updated',
  'timeline',
  'week',
  'hour',
  'world_clock',
  'location',
  'files',
  'button',
  'time_tracking',
  'formula',
  'dependency',
  'board_relation',
  'mirror',
] as const;

/** Types offered by the add-column picker, the "Add column to the right" menu and "Change column type", sorted alphabetically by display label. */
export const ADD_COLUMN_ORDER: readonly (typeof ADD_COLUMN_TYPES)[number][] = [...ADD_COLUMN_TYPES].sort((a, b) =>
  columnRegistry.get(a).label.localeCompare(columnRegistry.get(b).label, 'en', { sensitivity: 'base' }),
);
