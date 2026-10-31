import { autoNumberColumn } from './auto-number';
import { boardRelationColumn } from './board-relation';
import { buttonColumn } from './button';
import { checkboxColumn } from './checkbox';
import { colorPickerColumn } from './color';
import { countryColumn } from './country';
import { creationLogColumn } from './creation-log';
import { dateColumn } from './date';
import { dependencyColumn } from './dependency';
import { dropdownColumn } from './dropdown';
import { emailColumn } from './email';
import { filesColumn } from './files';
import { formulaColumn } from './formula';
import { hourColumn } from './hour';
import { itemIdColumn } from './item-id';
import { lastUpdatedColumn } from './last-updated';
import { linkColumn } from './link';
import { locationColumn } from './location';
import { longTextColumn } from './long-text';
import { mirrorColumn } from './mirror';
import { numbersColumn } from './numbers';
import { peopleColumn } from './people';
import { phoneColumn } from './phone';
import { progressColumn } from './progress';
import { ratingColumn } from './rating';
import { ColumnTypeRegistry } from './registry';
import { statusColumn } from './status';
import { tagsColumn } from './tags';
import { textColumn } from './text';
import { timeTrackingColumn } from './time-tracking';
import { timelineColumn } from './timeline';
import { voteColumn } from './vote';
import { weekColumn } from './week';
import { worldClockColumn } from './world-clock';

export * from './auto-number';
export * from './board-relation';
export * from './button';
export * from './checkbox';
export * from './color';
export * from './country';
export * from './creation-log';
export * from './date';
export * from './dependency';
export * from './dependency-graph';
export * from './dropdown';
export * from './email';
export * from './files';
export * from './formula';
export * from './hour';
export * from './item-id';
export * from './last-updated';
export * from './link';
export * from './location';
export * from './long-text';
export * from './mirror';
export * from './numbers';
export * from './people';
export * from './column-locks';
export * from './column-validation';
export * from './convert';
export * from './phone';
export * from './progress';
export * from './rating';
export * from './registry';
export * from './status';
export * from './tags';
export * from './text';
export * from './time-tracking';
export * from './timeline';
export * from './timestamp';
export type * from './types';
export * from './vote';
export * from './week';
export * from './world-clock';

/**
 * Registry containing every column type shipped so far: `text` and `status` (P0), P1 core set,
 * P2 simple columns set (`tags`, `rating`, `vote`, `color_picker`, `country`, `location`, `email`, `phone`),
 * `dependency`, P2 computed column types (`progress`, `auto_number`, `item_id`, `creation_log`, `last_updated`),
 * connect boards (`board_relation`) and `mirror`, button, files, the P2 time tracking column,
 * and P2 timeline/time columns (`timeline`, `week`, `hour`, `world_clock`).
 */
export function createColumnRegistry(): ColumnTypeRegistry {
  return new ColumnTypeRegistry()
    .register(textColumn)
    .register(statusColumn)
    .register(peopleColumn)
    .register(dateColumn)
    .register(numbersColumn)
    .register(dropdownColumn)
    .register(checkboxColumn)
    .register(linkColumn)
    .register(longTextColumn)
    .register(tagsColumn)
    .register(ratingColumn)
    .register(voteColumn)
    .register(colorPickerColumn)
    .register(countryColumn)
    .register(locationColumn)
    .register(emailColumn)
    .register(phoneColumn)
    .register(dependencyColumn)
    .register(progressColumn)
    .register(autoNumberColumn)
    .register(itemIdColumn)
    .register(creationLogColumn)
    .register(lastUpdatedColumn)
    .register(boardRelationColumn)
    .register(mirrorColumn)
    .register(buttonColumn)
    .register(filesColumn)
    .register(formulaColumn)
    .register(timelineColumn)
    .register(weekColumn)
    .register(hourColumn)
    .register(worldClockColumn)
    .register(timeTrackingColumn);
}

/** Shared default registry instance. */
export const columnRegistry: ColumnTypeRegistry = createColumnRegistry();
