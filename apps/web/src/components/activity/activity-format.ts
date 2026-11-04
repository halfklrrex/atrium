import { columnRegistry, type ActivityEvent, type ColumnDef } from '@atrium/shared';

/** Column types whose stored value is drawn with the column's own read-only cell in the log. */
const CELL_TYPES: ReadonlySet<string> = new Set([
  'status',
  'people',
  'date',
  'dropdown',
  'tags',
  'timeline',
]);

type EventLike = Pick<
  ActivityEvent,
  'kind' | 'actorName' | 'itemName' | 'columnTitle' | 'groupTitle' | 'data'
>;

const quote = (text: string | null | undefined) => (text ? `"${text}"` : 'an item');

/** Short headline of an entry: the column title for edits, otherwise what happened. */
export function activityLabel(event: EventLike): string {
  const { kind, columnTitle, data } = event;
  switch (kind) {
    case 'item_created':
      return 'Created';
    case 'item_renamed':
      return 'Renamed';
    case 'item_moved':
      return 'Moved';
    case 'item_archived':
      return 'Archived';
    case 'item_deleted':
      return 'Deleted';
    case 'item_restored':
      return 'Restored';
    case 'value_changed':
      if (data.more) return 'More changes';
      return columnTitle || 'Column';
    case 'update_posted':
      return 'Update posted';
    case 'button_clicked':
      return columnTitle ? `Clicked ${columnTitle}` : 'Button clicked';
    case 'automation_ran':
      return 'Automation ran';
    case 'column_added':
      return 'Column added';
    case 'column_renamed':
      return 'Column renamed';
    case 'column_deleted':
      return 'Column deleted';
    case 'column_type_changed':
      return 'Column type changed';
    case 'column_type_reverted':
      return 'Column type reverted';
    case 'group_added':
      return 'Group added';
    case 'group_renamed':
      return 'Group renamed';
    case 'group_deleted':
      return 'Group deleted';
    case 'board_renamed':
      return 'Board renamed';
    case 'board_kind_changed':
      return 'Board type changed';
    case 'board_access_changed':
      return 'Access changed';
    case 'board_left':
      return 'Left the board';
  }
}

/**
 * The whole entry as a sentence, used for board-level events and as the accessible name of a row:
 * "Avery Quinn renamed the group Done to Shipped".
 */
export function activitySentence(event: EventLike): string {
  const who = event.actorName || 'Someone';
  const { data, columnTitle, groupTitle } = event;
  const from = data.fromText ?? '';
  const to = data.toText ?? '';
  const item = quote(event.itemName);
  switch (event.kind) {
    case 'item_created':
      return `${who} created ${item}`;
    case 'item_renamed':
      return `${who} renamed ${quote(from)} to ${quote(to)}`;
    case 'item_moved':
      return data.fromGroupTitle
        ? `${who} moved ${item} from ${data.fromGroupTitle} to ${groupTitle ?? 'another group'}`
        : `${who} moved ${item} to ${groupTitle ?? 'another group'}`;
    case 'item_archived':
      return `${who} archived ${item}`;
    case 'item_deleted':
      return `${who} deleted ${item}`;
    case 'item_restored':
      return `${who} restored ${item}`;
    case 'value_changed':
      if (data.more) return `${who} made ${data.more} more changes to ${item}`;
      return `${who} changed ${columnTitle ?? 'a column'} on ${item} from ${from || 'empty'} to ${to || 'empty'}`;
    case 'update_posted':
      return `${who} posted an update on ${item}${data.snippet ? `: ${data.snippet}` : ''}`;
    case 'button_clicked':
      return `${who} clicked ${columnTitle ? `the button ${columnTitle}` : 'a button'} on ${item}`;
    case 'automation_ran':
      return `${who} ran an automation on ${item}`;
    case 'column_added':
      return `${who} added the column ${columnTitle ?? ''}`.trim();
    case 'column_renamed':
      return `${who} renamed the column ${from} to ${to}`;
    case 'column_deleted':
      return `${who} deleted the column ${columnTitle ?? ''}`.trim();
    case 'column_type_changed':
      return `${who} changed the type of ${columnTitle ?? 'a column'} from ${from} to ${to}`;
    case 'column_type_reverted':
      return `${who} reverted the type of ${columnTitle ?? 'a column'} from ${from} to ${to}`;
    case 'group_added':
      return `${who} added the group ${groupTitle ?? ''}`.trim();
    case 'group_renamed':
      return `${who} renamed the group ${from} to ${to}`;
    case 'group_deleted':
      return `${who} deleted the group ${groupTitle ?? ''}`.trim();
    case 'board_renamed':
      return `${who} renamed the board ${from} to ${to}`;
    case 'board_kind_changed':
      return `${who} changed the board from ${data.fromKind ?? ''} to ${data.toKind ?? ''}`;
    case 'board_access_changed': {
      const target = data.targetName || 'someone';
      if (!data.toRole) return `${who} removed ${target} from the board`;
      if (!data.fromRole) return `${who} added ${target} as ${data.toRole}`;
      return `${who} changed ${target} from ${data.fromRole} to ${data.toRole}`;
    }
    case 'board_left':
      return `${who} left the board`;
  }
}

/** Entries about the board itself (no item): shown as a sentence, not as a row of values. */
export const isBoardLevel = (event: Pick<ActivityEvent, 'itemId' | 'kind'>): boolean =>
  event.itemId === null && event.kind !== 'value_changed';

/** How one side (old or new) of a `value_changed` entry is shown. */
export type ValueView =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'cell'; column: ColumnDef; value: unknown; settings: unknown };

/**
 * Picks how to show the old or new value: with the column's read-only cell when the column still
 * exists with the same type and the raw value was stored and is still valid, otherwise the stored
 * text, otherwise "empty".
 */
export function valueView(
  event: Pick<ActivityEvent, 'columnId' | 'columnType' | 'data'>,
  side: 'from' | 'to',
  columns: readonly ColumnDef[],
): ValueView {
  const text = (side === 'from' ? event.data.fromText : event.data.toText) ?? '';
  const raw = side === 'from' ? event.data.fromValue : event.data.toValue;
  const column = columns.find((c) => c.id === event.columnId);
  if (
    column &&
    raw !== undefined &&
    raw !== null &&
    column.type === event.columnType &&
    CELL_TYPES.has(column.type) &&
    columnRegistry.has(column.type)
  ) {
    const value = columnRegistry.parseValue(column.type, raw);
    const settings = columnRegistry.parseSettings(column.type, column.settings);
    if (value.success && settings.success) {
      return { kind: 'cell', column, value: value.data, settings: settings.data };
    }
  }
  return text ? { kind: 'text', text } : { kind: 'empty' };
}
