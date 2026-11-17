// Tool catalogue: items, subitems, descriptions, votes and activity.
import { z } from 'zod';
import { MAX_ITEMS_PER_CALL } from '../service/constants.mjs';
import { UNTRUSTED, add, addOnce, cellValues, change, id, read, ref } from './helpers.mjs';

/** @param {ReturnType<typeof import('../service.mjs').createService>} service */
export const itemTools = (service) => [
  add({
    name: 'atrium_create_items',
    description:
      `Creates up to ${MAX_ITEMS_PER_CALL} items at the end of their groups. Each item: name, optional group ` +
      '(id or title, default the first group) and optional values. Additive.',
    inputSchema: {
      boardId: id,
      items: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(500),
            group: ref.optional(),
            values: cellValues.optional(),
          }),
        )
        .min(1)
        .max(MAX_ITEMS_PER_CALL),
    },
    run: (args) => service.createItems(args),
  }),
  change({
    name: 'atrium_update_item',
    description:
      'Changes an item or subitem: name, group (items only; moves it, with its subitems, to the end of that group) and/or cell values ' +
      '(a subitem uses the board columns too). Only the given cells change; null clears a cell, except on a required column.',
    inputSchema: {
      boardId: id,
      itemId: id,
      name: z.string().trim().min(1).max(500).optional(),
      group: ref.optional(),
      values: cellValues.optional(),
    },
    run: (args) => service.updateItem(args),
  }),
  read({
    name: 'atrium_get_item_description',
    description:
      "Read-only. Returns an item's rich-text description as markdown (plus plain text and the names of any " +
      'nodes markdown cannot show, such as images or tables).' +
      UNTRUSTED,
    inputSchema: { boardId: id, itemId: id },
    run: (args) => service.getItemDescription(args),
  }),
  change({
    name: 'atrium_set_item_description',
    description:
      "Writes an item's description (the rich-text body in the item view) from markdown: headings (#), bold, " +
      'italic, ~~strike~~, `code`, [links](https://...), bullet/numbered/task (- [ ]) lists, > quotes, ``` code blocks, ---, ' +
      'GFM pipe tables and @[Name] mentions of members who can see the board (they get a notification). ' +
      'mode "replace" (the default) overwrites; "append" adds to the end. Empty markdown with replace clears it. ' +
      'Refuses to replace a description holding images, emoji, colored text or tables with merged cells unless allowOverwriteRich is true.',
    inputSchema: {
      boardId: id,
      itemId: id,
      markdown: z.string().max(50000),
      mode: z.enum(['replace', 'append']).optional(),
      allowOverwriteRich: z.boolean().optional(),
    },
    run: (args) => service.setItemDescription(args),
  }),
  change({
    name: 'atrium_archive_item',
    description:
      'Archives an item or subitem (state archived; an item takes its subitems along). Reversible in the Atrium app.',
    inputSchema: { boardId: id, itemId: id },
    run: (args) => service.setItemState({ ...args, state: 'archived' }),
  }),
  change({
    name: 'atrium_delete_item',
    description:
      "Soft-deletes an item or subitem (state deleted, like the app's trash; an item takes its subitems along). Never a hard delete; restorable in the app.",
    inputSchema: { boardId: id, itemId: id },
    run: (args) => service.setItemState({ ...args, state: 'deleted' }),
  }),
  read({
    name: 'atrium_list_subitems',
    description:
      "Read-only. Lists an item's subitems (id, name, values keyed by column title) and the board columns (subitems share them). " +
      "A subitem's id works with atrium_update_item, atrium_get/set_item_description, atrium_add_update, atrium_archive_item and the other item tools." +
      UNTRUSTED,
    inputSchema: { boardId: id, itemId: id },
    run: (args) => service.listSubitems(args),
  }),
  add({
    name: 'atrium_create_subitems',
    description:
      `Creates up to ${MAX_ITEMS_PER_CALL} subitems under a top-level item, after its existing subitems, in the parent's group. ` +
      'Values are keyed by board column title or id (subitems share the board columns; see atrium_get_board). ' +
      'Needs the editor role, writes no columns. Additive.',
    inputSchema: {
      boardId: id,
      itemId: id.describe('The parent item.'),
      subitems: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(500),
            values: cellValues.optional(),
          }),
        )
        .min(1)
        .max(MAX_ITEMS_PER_CALL),
    },
    run: (args) => service.createSubitems(args),
  }),
  add({
    name: 'atrium_duplicate_item',
    description:
      'Copies an item (or a subitem) next to the original as "Name (copy)", with its cell values and, for an item, its active subitems. ' +
      'Calculated and server-managed cells, descriptions and updates are not copied. Additive.',
    inputSchema: { boardId: id, itemId: id },
    run: (args) => service.duplicateItem(args),
  }),
  change({
    name: 'atrium_move_item_to_board',
    description:
      'Moves an item (with its active subitems) to another board of the same workspace by COPYING it: the new item has a new id and number and is created now by you, ' +
      'and the original (with its updates and files) goes to the trash, so atrium_restore_item brings it back. Values are mapped to the target by column id, else by title and type; ' +
      'status, dropdown and tags map by label text and never create labels. Calculated, files, time tracking, button and dependency cells, ' +
      'unmatched columns and the description are not copied. If anything would be left behind (or the item has updates) the call refuses until allowDataLoss is true; ' +
      'dryRun previews the report without writing. Board automations on the target see a new item. Needs the editor role on both boards.',
    inputSchema: {
      boardId: id,
      itemId: id,
      targetBoardId: id,
      group: ref.optional().describe("Target group id or title; default the target's first group."),
      dryRun: z.boolean().optional().describe('Default false. Preview only; nothing is written.'),
      allowDataLoss: z
        .boolean()
        .optional()
        .describe(
          'Default false. Needed when the report lists dropped cells or the item has updates.',
        ),
    },
    run: (args) => service.moveItemToBoard(args),
  }),
  read({
    name: 'atrium_get_activity',
    description:
      "Read-only. The board's recent activity log (newest first), optionally only for one item and its subitems: " +
      'kind, actor, time, item, column, old and new value text. Entries expire after 90 days.' +
      UNTRUSTED,
    inputSchema: {
      boardId: id,
      itemId: id.optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Default 30.'),
    },
    run: (args) => service.getActivity(args),
  }),
  read({
    name: 'atrium_find_items',
    description:
      'Read-only. Finds active top-level items of a board: name contains text (case-insensitive), optionally in one group, ' +
      'and/or where columns equal a value (where: [{column, equals}]; equals is the readable cell text, a status label, a person uid, ' +
      'true/false, a number, or null for empty). All filters must match. Paged: pass nextOffset as offset for the next page.' +
      UNTRUSTED,
    inputSchema: {
      boardId: id,
      name: z.string().trim().min(1).max(200).optional(),
      group: ref.optional(),
      where: z
        .array(
          z.object({
            column: ref,
            equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          }),
        )
        .max(10)
        .optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Default 25.'),
      offset: z.number().int().min(0).optional(),
    },
    run: (args) => service.findItems(args),
  }),
  change({
    name: 'atrium_restore_item',
    description:
      'Restores an archived or deleted (trashed) item or subitem to active, with the subitems that went away with it. ' +
      'A subitem needs an active parent. If its group was deleted meanwhile the item lands in the first group. Needs the editor role.',
    inputSchema: { boardId: id, itemId: id },
    run: (args) => service.restoreItem(args),
  }),
  change({
    name: 'atrium_move_item',
    description:
      'Moves an item to a group (id or title; default its own group) and a place in it: position "first" or "last" ' +
      '(default last), or right before or after another item of that group (beforeItemId / afterItemId; give one placement). ' +
      'Subitems follow their parent. A subitem cannot change group, only its place among its siblings. Needs the editor role.',
    inputSchema: {
      boardId: id,
      itemId: id,
      group: ref.optional(),
      position: z.enum(['first', 'last']).optional(),
      beforeItemId: id.optional(),
      afterItemId: id.optional(),
    },
    run: (args) => service.moveItem(args),
  }),
  addOnce({
    name: 'atrium_vote_item',
    description:
      'Adds your vote to an item (or subitem) in a vote column. column (id or title) may be left out when the item has exactly one ' +
      'vote column. Voting twice changes nothing. Returns the vote count. Needs the editor role.',
    inputSchema: { boardId: id, itemId: id, column: ref.optional() },
    run: (args) => service.setVote({ ...args, voted: true }),
  }),
  addOnce({
    name: 'atrium_unvote_item',
    description:
      'Removes your vote from an item (or subitem) in a vote column; column may be left out when there is exactly one. ' +
      'Removing without a vote changes nothing. Needs the editor role.',
    inputSchema: { boardId: id, itemId: id, column: ref.optional() },
    run: (args) => service.setVote({ ...args, voted: false }),
  }),
];
