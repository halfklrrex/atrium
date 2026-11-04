import type { TemplateSampleItem, TemplateStructure } from '@atrium/shared';
import { positionBetween } from '../lib/positions';
import type { NewItemInput } from './seed-items';

/**
 * Turn a template's sample items into item inputs with fractional positions: items keep their list
 * order within their group. Throws when an item names a group the structure does not define (group
 * ids are kept when a board is built, so every sample item must resolve).
 */
export function sampleItemsToInputs(
  structure: Pick<TemplateStructure, 'groups'>,
  sampleItems: readonly TemplateSampleItem[],
): NewItemInput[] {
  const groupIds = new Set(structure.groups.map((g) => g.id));
  const lastPosition = new Map<string, string>();
  return sampleItems.map((item) => {
    if (!groupIds.has(item.groupId)) {
      throw new Error(`Sample item "${item.name}" is in an unknown group "${item.groupId}"`);
    }
    const position = positionBetween(lastPosition.get(item.groupId) ?? null, null);
    lastPosition.set(item.groupId, position);
    return {
      name: item.name,
      groupId: item.groupId,
      position,
      values: structuredClone(item.values),
    };
  });
}
