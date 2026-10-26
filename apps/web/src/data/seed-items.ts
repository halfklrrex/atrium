import type { BoardStructure } from '@atrium/shared';
import { comparePositions } from '../lib/positions';

/** The shape `itemWrites.createMany` takes. */
export interface NewItemInput {
  name: string;
  groupId: string;
  position: string;
  values?: Record<string, unknown>;
  /** Set for a subitem: the id of its (top-level) parent item. Omitted or `null` for an item. */
  parentItemId?: string | null;
}

/**
 * Items a brand new board starts with, as in monday: "Item 1" to "Item 3" in the first group
 * (status "Working on it", "Done" and "Stuck") and "Item 4" and "Item 5" in the second. Every other
 * value stays empty.
 */
export function newBoardSeedItems(structure: BoardStructure): NewItemInput[] {
  const [first, second] = [...structure.groups].sort(comparePositions).slice(0, 2);
  if (!first) return [];
  const statusColumn = structure.columns.find((c) => c.type === 'status');
  const statusLabels = [0, 1, 2];

  const make = (
    n: number,
    groupId: string,
    position: string,
    statusIndex: number | undefined,
  ): NewItemInput => ({
    name: `Item ${n}`,
    groupId,
    position,
    values:
      statusColumn && statusIndex !== undefined
        ? { [statusColumn.id]: { index: statusIndex } }
        : {},
  });

  return [
    ...statusLabels.map((statusIndex, i) => make(i + 1, first.id, `a${i}`, statusIndex)),
    ...(second ? [make(4, second.id, 'a0', undefined), make(5, second.id, 'a1', undefined)] : []),
  ];
}
