import { z } from 'zod';
import { slugIdSchema } from '../schemas/board';
import { hexColorSchema, idSchema, uidSchema } from '../schemas/common';
import { defineColumnType } from './registry';

export const BUTTON_LIMITS = { maxActions: 5, maxNotifyUids: 10, maxNotifyMessage: 140 } as const;

/**
 * One step a button runs on its item. Plain data (`{ type, ...params }`) so P5 automations can
 * reuse the same schema and executor.
 */
export const buttonActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_value'), columnId: idSchema, value: z.unknown() }).strict(),
  z.object({ type: z.literal('rename_item'), template: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal('move_to_group'), groupId: slugIdSchema }).strict(),
  z.object({ type: z.literal('archive_item') }).strict(),
  z
    .object({
      type: z.literal('notify'),
      uids: z.array(uidSchema).min(1).max(BUTTON_LIMITS.maxNotifyUids),
      message: z.string().max(BUTTON_LIMITS.maxNotifyMessage).optional(),
    })
    .strict(),
]);
export type ButtonAction = z.infer<typeof buttonActionSchema>;

export const BUTTON_ACTION_LABELS: Record<ButtonAction['type'], string> = {
  set_value: 'Set value',
  rename_item: 'Rename item',
  move_to_group: 'Move to group',
  archive_item: 'Archive item',
  notify: 'Notify people',
};

/** Longest item name a click may produce (the item name limit). */
export const BUTTON_RENAME_MAX_LENGTH = 500;

/**
 * Fills a `rename_item` template: `{name}` is the current item name, `{date}` today
 * (`YYYY-MM-DD`, UTC). Unknown `{tokens}` stay literal. The result is trimmed; callers refuse an
 * empty or over-long result.
 */
export function renderRenameTemplate(template: string, itemName: string, nowMs: number): string {
  const date = new Date(nowMs).toISOString().slice(0, 10);
  return template
    .replace(/\{(name|date)\}/g, (_m, token: string) => (token === 'name' ? itemName : date))
    .trim();
}

export const buttonSettingsSchema = z
  .object({
    /** Label displayed inside the button (e.g. "Run", "Approve", "Submit"). */
    label: z.string().min(1).max(50).default('Click'),
    /** Button color matching Atrium's status/group palette. */
    color: hexColorSchema.default('#579bfc'),
    /** Steps run in order, all or nothing, when the button is clicked. Empty: record the click only. */
    actions: z.array(buttonActionSchema).max(BUTTON_LIMITS.maxActions).default([]),
  })
  .strict();
export type ButtonSettings = z.infer<typeof buttonSettingsSchema>;

/**
 * Button column has no stored cell value. Label and colour live in column settings.
 * Button clicks execute through a backend callable that verifies edit permissions
 * and appends an event to `boards/{id}/activity`.
 */
export const buttonValueSchema = z.object({}).strict();
export type ButtonValue = z.infer<typeof buttonValueSchema>;

export const buttonColumn = defineColumnType<ButtonSettings, ButtonValue>({
  type: 'button',
  label: 'Button',
  // FW2: clicks go through a callable; clients never write the cell.
  serverManaged: true,
  settingsSchema: buttonSettingsSchema,
  valueSchema: buttonValueSchema,
  summaries: ['count', 'count_empty'],
  defaultSettings: () => ({
    label: 'Click',
    color: '#579bfc',
    actions: [],
  }),
  toText: (_value, settings) => settings.label,
  compare: () => 0,
});
