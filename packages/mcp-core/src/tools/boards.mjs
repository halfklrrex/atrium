// Tool catalogue: workspaces, boards, groups and columns.
import { z } from 'zod';
import { CREATABLE_COLUMN_TYPES } from '../values.mjs';
import {
  UNTRUSTED,
  add,
  addOnce,
  change,
  id,
  labelEntry,
  read,
  ref,
  workspaceId,
} from './helpers.mjs';

/** @param {ReturnType<typeof import('../service.mjs').createService>} service */
export const boardTools = (service) => [
  read({
    name: 'atrium_list_workspaces',
    description:
      'Read-only. Lists the Atrium workspaces you are a member of (id, name, your role). Call it first when a ' +
      'tool asks for a workspaceId.',
    inputSchema: {},
    run: () => service.listWorkspaces(),
  }),
  read({
    name: 'atrium_list_boards',
    description:
      'Read-only. Lists the boards you can see in a workspace (id, name, kind, state); state picks active (the default), ' +
      'archived or deleted (the trash). workspaceId may be left out when you are a member of exactly one workspace.',
    inputSchema: {
      workspaceId,
      state: z.enum(['active', 'archived', 'deleted']).optional().describe('Default active.'),
    },
    run: (args) => service.listBoards(args),
  }),
  read({
    name: 'atrium_get_board',
    description:
      'Read-only. Returns a board: its columns (id, title, type, labels), groups and active items ' +
      '(id, seq, name, group, values keyed by column title, subitems nested with values keyed by the same column titles).' +
      UNTRUSTED,
    inputSchema: {
      boardId: id,
      includeItems: z.boolean().optional().describe('Default true.'),
      limit: z.number().int().min(1).max(1000).optional().describe('Max items, default 200.'),
    },
    run: (args) => service.getBoard(args),
  }),
  read({
    name: 'atrium_list_templates',
    description:
      'Read-only. Lists the board templates you can create a board from: the built-in ones and the templates saved in the ' +
      'workspace (id, source, name, description, column titles and types, group titles, number of sample items). Pass an id to ' +
      'atrium_create_board as templateId. workspaceId may be left out when you are a member of exactly one workspace.',
    inputSchema: { workspaceId },
    run: (args) => service.listTemplates(args),
  }),
  add({
    name: 'atrium_create_board',
    description:
      'Creates a new board at the end of the workspace root, owned by you. Without templateId it has the default Person, ' +
      'Status and Date columns, two groups and no sample items. With templateId (from atrium_list_templates) it gets the ' +
      "template's columns and groups and, unless includeSampleItems is false, its sample items. Needs the member role or " +
      'higher in the workspace. Additive.',
    inputSchema: {
      name: z.string().trim().min(1).max(120),
      description: z.string().max(1000).optional(),
      workspaceId,
      templateId: id
        .optional()
        .describe('A built-in or saved template id; see atrium_list_templates.'),
      includeSampleItems: z.boolean().optional().describe('Only with templateId. Default true.'),
    },
    run: (args) => service.createBoard(args),
  }),
  add({
    name: 'atrium_add_group',
    description: 'Adds a group at the end of a board. Needs the board owner role. Additive.',
    inputSchema: {
      boardId: id,
      title: z.string().trim().min(1).max(120),
      color: z.string().optional().describe('#RRGGBB or a name such as blue, green, purple.'),
    },
    run: (args) => service.addGroup(args),
  }),
  change({
    name: 'atrium_rename_group',
    description: 'Renames a group (found by id or title). Needs the board owner role.',
    inputSchema: { boardId: id, group: ref, title: z.string().trim().min(1).max(120) },
    run: (args) => service.renameGroup(args),
  }),
  change({
    name: 'atrium_delete_group',
    description:
      'Removes an empty group from the board layout. Refuses while the group still has active items or is the last group.',
    inputSchema: { boardId: id, group: ref },
    run: (args) => service.deleteGroup(args),
  }),
  add({
    name: 'atrium_add_column',
    description:
      `Adds a column at the end of a board. Types: ${CREATABLE_COLUMN_TYPES.join(', ')}. ` +
      'For status, dropdown and tags pass the labels as settings.addLabels (status: texts or {label,color}). ' +
      "Other settings are the type's own (e.g. rating: {limit, symbol}). " +
      'Calculated types (formula: {expression, outputType, decimalPlaces?}, progress: {statusColumns: [status columns]}, ' +
      'item_id, auto_number, creation_log, last_updated, mirror) and managed ones (files, time_tracking) hold no value you can set; ' +
      'vote columns are written with atrium_vote_item (at most 10 per board). ' +
      'board_relation: {boards: [board ids or names you can read], allowMultipleItems?}; ' +
      'mirror: {relationColumn: a board_relation column, targetColumns: {board: column to show}, aggregation?}; ' +
      'dependency: {strict?, timeColumn?}. Needs the board owner role. Additive.',
    inputSchema: {
      boardId: id,
      title: z.string().trim().min(1).max(120),
      type: z.enum(CREATABLE_COLUMN_TYPES),
      settings: z.record(z.string(), z.unknown()).optional(),
    },
    run: (args) => service.addColumn(args),
  }),
  add({
    name: 'atrium_update_column_settings',
    description:
      "Changes a column's settings. Use settings.addLabels to add status labels, dropdown options or tags; labels are " +
      'never removed and the column type never changes. Needs the board owner role.',
    inputSchema: {
      boardId: id,
      column: ref,
      settings: z.object({ addLabels: z.array(labelEntry).optional() }).catchall(z.unknown()),
    },
    run: (args) => service.updateColumnSettings(args),
  }),
  change({
    name: 'atrium_rename_column',
    description:
      'Renames a column (found by id or title). The new title must not be used by another column. Needs the board owner role.',
    inputSchema: { boardId: id, column: ref, title: z.string().trim().min(1).max(120) },
    run: (args) => service.renameColumn(args),
  }),
  change({
    name: 'atrium_delete_column',
    description:
      'Deletes a column and clears its values from every item. Cannot be undone. Calculated, managed and required columns ' +
      'keep their stored leftovers (invisible without the column). If cleaning up values fails after the column is gone, the answer carries a warning and the count cleared. Needs the board owner role.',
    inputSchema: { boardId: id, column: ref },
    run: (args) => service.deleteColumn(args),
  }),
  change({
    name: 'atrium_reorder_columns',
    description:
      'Sets the order of the columns of a board. List every column (id or title) exactly once, in the wanted order. Needs the board owner role.',
    inputSchema: { boardId: id, columns: z.array(ref).min(1).max(200) },
    run: (args) => service.reorderColumns(args),
  }),
  change({
    name: 'atrium_lock_column',
    description:
      'Locks a column so only board owners can change its cells. Locking twice changes nothing. Needs the board owner role.',
    inputSchema: { boardId: id, column: ref },
    run: (args) => service.setColumnLock({ ...args, locked: true }),
  }),
  change({
    name: 'atrium_unlock_column',
    description:
      'Unlocks a column so editors can change its cells again. Needs the board owner role.',
    inputSchema: { boardId: id, column: ref },
    run: (args) => service.setColumnLock({ ...args, locked: false }),
  }),
  change({
    name: 'atrium_reorder_groups',
    description:
      'Sets the order of the groups of a board. List every group (id or title) exactly once, in the wanted order. Needs the board owner role.',
    inputSchema: { boardId: id, groups: z.array(ref).min(1).max(200) },
    run: (args) => service.reorderGroups(args),
  }),
  addOnce({
    name: 'atrium_rename_board',
    description:
      "Changes a board's name and/or description (give at least one). Returns the new and previous values. Needs the editor role.",
    inputSchema: {
      boardId: id,
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(1000).optional(),
    },
    run: (args) => service.renameBoard(args),
  }),
  addOnce({
    name: 'atrium_archive_board',
    description:
      'Archives an active board (hidden from the sidebar, restorable with atrium_restore_board). Needs the board owner role.',
    inputSchema: { boardId: id },
    run: (args) => service.setBoardState({ ...args, to: 'archived' }),
  }),
  change({
    name: 'atrium_delete_board',
    description:
      'Moves a board to the trash; it is purged after 30 days, and atrium_restore_board brings it back until then. ' +
      'Needs the board owner role.',
    inputSchema: { boardId: id },
    run: (args) => service.setBoardState({ ...args, to: 'deleted' }),
  }),
  addOnce({
    name: 'atrium_restore_board',
    description:
      'Restores an archived or trashed board to active. Its items keep their own states. Needs the board owner role.',
    inputSchema: { boardId: id },
    run: (args) => service.setBoardState({ ...args, to: 'active' }),
  }),
];
