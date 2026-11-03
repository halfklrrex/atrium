# P2 Spec: Button actions (multi-step)

**Roadmap item:** Button column (`3306219470`). **Branch:** `claude/button-actions`. **Owner request (2026-10-31):** a button should run a configured sequence of actions, like the owner's old Trello button that closed a card, changed its title and moved it. Builds on `P2-button-column.md` (the cell itself and the `clickButton` callable already exist and only record `button_clicked`).

## Decisions

1. **Settings hold an ordered list of actions** (`actions`, 0 to 5). An empty list keeps today's behaviour (record the click only), so existing buttons need no migration.
2. **All-or-nothing.** A click validates every action first and then applies them in one transaction. If any action is invalid or not allowed, nothing is written and the callable throws `failed-precondition` with a message naming the action ("Action 2 (Move to group): the group no longer exists").
3. **Server-side only.** The web app never applies actions. The `clickButton` callable does, as the clicking user: they need the same permissions they would have editing by hand (board edit role, and `canEditColumn` for every column an action writes, so a column locked to owners can't be written by an editor through a button).
4. **Slices.** This PR is **slice A**: `set_value`, `rename_item`, `move_to_group`, `archive_item`. **Slice B** (separate PR, later) adds `notify`, because it needs a new notification kind, notification preferences and a rules change (hot spot).
5. **Reusable shape.** The action objects are deliberately plain data (`{ type, ...params }`) so P5 automations can reuse the same schema and executor as their "actions library". Log this on the Decisions board when merged.

## Shared (`packages/shared/src/columns/button.ts`, hot spot)

```ts
export const BUTTON_LIMITS = { maxActions: 5 } as const;

export const buttonActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_value'), columnId: idSchema, value: z.unknown() }).strict(),
  z.object({ type: z.literal('rename_item'), template: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal('move_to_group'), groupId: slugIdSchema }).strict(),
  z.object({ type: z.literal('archive_item') }).strict(),
]);
```

- `buttonSettingsSchema` gains `actions: z.array(buttonActionSchema).max(BUTTON_LIMITS.maxActions).default([])`. It stays `.strict()`; `defaultSettings` returns `actions: []`.
- `rename_item.template` supports `{name}` (current item name) and `{date}` (today, `YYYY-MM-DD`, UTC). Unknown `{tokens}` are kept literally. Result is trimmed and must be 1 to 500 characters, else the click is refused.
- A pure helper `validateButtonActions(actions, board, role)` returns `{ ok: true } | { ok: false, index, message }`. It checks that:
  - `set_value.columnId` exists on `board.columns`, is not derived, server-managed or `button`, is not `migrating`, and the value passes `columnRegistry.validateCell`;
  - a `move_to_group` target exists in `board.groups`;
  - the role may edit each target column (`canEditColumn`, from the existing column-locks helper).
- Column settings writes (web) must also run the settings-time part of this check (columns and groups exist, values valid) so a bad action can't be saved. Reuse `column-validation.ts`, where settings are validated per type.
- `ClickButtonResult` gains `applied: { type: ButtonAction['type'] }[]`. Existing fields stay.
- Tests: schema accepts valid and rejects unknown keys, more than 5 actions, bad template length; `validateButtonActions` per failure case; `toText` unchanged.

## Functions (`functions/src/lib/column-actions.ts`)

- Extend `ColumnActionsTx` with `updateItem(boardId, itemId, patch: Record<string, unknown>, updatedBy, serverTimestamp)`: a **field-path patch** (`values.<colId>`, `name`, `groupId`, `state`, `position`), never the whole `values` map (AGENTS.md). Implement it in the admin adapter next to `updateItemValues`, and add it to the in-memory fake used by the tests.
- `clickButtonInTransaction`:
  1. Existing checks (edit access, column is a button, item active).
  2. `validateButtonActions(settings.actions, board, role)`; throw `failed-precondition` on failure.
  3. Build one merged patch in order. Later actions win on the same key (two `set_value` on the same column: the last one). `set_value` writes `values.<columnId>` after `validateCell`; a `null` value clears the cell. `move_to_group` sets `groupId` and `position` to the end of the target group (`generateKeyBetween(last position in that group, null)`, read inside the transaction with the same query the web uses; if that read is too costly, use the item's current position with the new group and note it in the PR). `rename_item` sets `name`. `archive_item` sets `state: 'archived'`.
  4. `tx.updateItem(...)` once, with `updatedBy = uid` (the activity triggers will log the resulting value, name, move and archive entries with the clicking user as the actor, so no extra activity code is needed), then the existing `button_clicked` activity entry, now with `data.actions` (the action types, max 5).
- Do not touch `seq`, `boardSeq`, derived or server-managed fields. Required-column rules are not applied to values set by a button (same as other server writes); note in the PR if `validateCell` enforces something else.
- Tests (fakes): every action type; order and last-wins; all-or-nothing on a bad second action (no `updateItem` call); locked column refused for an editor and allowed for an owner; viewer refused; archived item refused; empty `actions` behaves exactly as before.
- Emulator end-to-end (`tests/rules/src/button-actions.e2e.test.ts`, modelled on `activity.e2e.test.ts`): a click that sets a status and renames the item produces the item changes and the activity entries. `pnpm test:rules` runs it on its own.

## Web

1. **Settings editor** in `apps/web/src/components/board-table/ColumnSettings.tsx` (button section): an "Actions" list below Label and Colour. "Add action" menu (the four types), each row has a type label, its parameter editor, Move up, Move down and Remove (icon buttons with `aria-label`), 5 max (then the menu is disabled with the reason). Parameter editors:
   - `set_value`: column picker (only writable simple columns), then the column's own cell editor for the value (reuse the existing cell editor components; do not write a new one), with a "Clear value" choice.
   - `rename_item`: text field with a helper line about `{name}` and `{date}`.
   - `move_to_group`: group picker with the colour dot.
   - `archive_item`: no parameters, helper text "The item moves to the archive".
     Deleted columns or groups referenced by an action show the row in an error state ("This column was deleted") and block saving.
2. **Click** (`apps/web/src/columns/button.tsx`): after the callable returns, the toast reads "Done: N actions ran" (or the existing text when there are none). Errors use `describeCallableError`, which shows the server's message.
3. Style: Vibe components and existing tokens only; measure against monday's "Button" column settings in `docs/reference/monday-ui-reference.md` (Claude's home copy). Add `visual` screens: the settings editor with 3 actions, light and dark.

## Showcase

Add a button column to the showcase board (`scripts/showcase/data.mjs`): "Mark as shipped" with `set_value` Status = Done and `rename_item` `{name}`. The seeder must resolve the Status column id and label at seed time. Ophelia re-runs it on production after merge.

## Out of scope

Conditions, delays, running on a schedule, creating items, URL or webhook actions, undo of a click, per-button permissions beyond column locks, `notify` (slice B), and triggering from anything but a click (all P5).

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`; the baselines workflow for the visual screens.

## PR split

**One PR `claude/button-actions`** (hot spot: `packages/shared/**`; no `firestore.rules` change and no `pnpm-lock.yaml`). Files: `packages/shared/src/columns/button.ts` (+ test), `column-validation.ts`, `packages/shared/src/schemas/*` for the callable result type, `functions/src/lib/column-actions.ts` (+ test), the admin adapter, `tests/rules/src/button-actions.e2e.test.ts`, `apps/web/src/components/board-table/ColumnSettings.tsx` (+ a new `ButtonActionsEditor.tsx` with its CSS module and test), `apps/web/src/columns/button.tsx` (+ test), `tests/visual/**`, `scripts/showcase/data.mjs`, `docs/architecture.md` (button actions note in §6.2).
