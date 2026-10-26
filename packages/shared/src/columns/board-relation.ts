import { z } from 'zod';
import { defineColumnType } from './registry';

export const linkedItemRefSchema = z
  .object({
    boardId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
  })
  .strict();
export type LinkedItemRef = z.infer<typeof linkedItemRefSchema>;

export const boardRelationSettingsSchema = z
  .object({
    boardIds: z
      .array(z.string().min(1).max(128))
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'boardIds must be unique',
      })
      .default([]),
    allowMultipleItems: z.boolean().default(true),
    twoWay: z.boolean().default(false),
    twoWayColumnId: z.string().min(1).max(64).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.twoWay && !data.twoWayColumnId) {
      ctx.addIssue({
        code: 'custom',
        path: ['twoWayColumnId'],
        message: 'twoWayColumnId is required when twoWay is true',
      });
    }
    if (!data.twoWay && data.twoWayColumnId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['twoWayColumnId'],
        message: 'twoWayColumnId cannot be set when twoWay is false',
      });
    }
  });
export type BoardRelationSettings = z.infer<typeof boardRelationSettingsSchema>;

export const boardRelationValueSchema = z
  .object({
    linkedItems: z
      .array(linkedItemRefSchema)
      .max(1000)
      .refine(
        (items) => {
          const keys = new Set(items.map((i) => `${i.boardId}:${i.itemId}`));
          return keys.size === items.length;
        },
        {
          message: 'linkedItems must be unique {boardId, itemId} pairs',
        },
      ),
  })
  .strict();
export type BoardRelationValue = z.infer<typeof boardRelationValueSchema>;

/**
 * Checks whether a relation value conforms to settings (e.g. single item restriction and allowed board IDs).
 */
export function isRelationWithinSettings(
  value: BoardRelationValue,
  settings: BoardRelationSettings,
): boolean {
  if (!settings.allowMultipleItems && value.linkedItems.length > 1) {
    return false;
  }
  if (settings.boardIds.length > 0) {
    const allowed = new Set(settings.boardIds);
    for (const item of value.linkedItems) {
      if (!allowed.has(item.boardId)) {
        return false;
      }
    }
  }
  return true;
}

export const boardRelationColumn = defineColumnType<BoardRelationSettings, BoardRelationValue>({
  type: 'board_relation',
  label: 'Connect boards',
  settingsSchema: boardRelationSettingsSchema,
  valueSchema: boardRelationValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({
    boardIds: [],
    allowMultipleItems: true,
    twoWay: false,
  }),
  toText: (value) => value.linkedItems.map((i) => i.itemId).join(', '),
  compare: (a, b) => {
    const diff = a.linkedItems.length - b.linkedItems.length;
    if (diff !== 0) return diff;
    const strA = a.linkedItems.map((i) => `${i.boardId}:${i.itemId}`).join(',');
    const strB = b.linkedItems.map((i) => `${i.boardId}:${i.itemId}`).join(',');
    return strA.localeCompare(strB);
  },
});
