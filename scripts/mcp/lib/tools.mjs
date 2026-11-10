// The tool catalogue: names, descriptions and input schemas, bound to the service. The MCP wiring in
// `atrium-mcp.mjs` only registers these, so the list is testable without a transport.
import { z } from 'zod';
import { CREATABLE_COLUMN_TYPES } from './values.mjs';
import { ID_PATTERN } from './errors.mjs';
import { MAX_ITEMS_PER_CALL } from './service.mjs';

const id = z.string().regex(ID_PATTERN, 'Expected a plain id');
const ref = z.string().min(1).max(200);
const cellValues = z
  .record(z.string(), z.unknown())
  .describe(
    'Cell values keyed by column title or id. status: label text; dropdown/tags: label text or an array of texts; ' +
      'date: "YYYY-MM-DD"; timeline: ["YYYY-MM-DD","YYYY-MM-DD"]; checkbox: true/false; rating: number; ' +
      'link: a URL; long_text/text: a string; numbers: a number; people: a workspace member uid, "me" or an array of those. ' +
      'null clears a cell. Calculated columns cannot be set.',
  );
const labelEntry = z.union([
  z.string().min(1).max(60),
  z.object({ label: z.string().min(1).max(60), color: z.string().optional() }),
]);

export function defineTools(service) {
  return [
    {
      name: 'atrium_list_boards',
      description:
        'Read-only. Lists the active boards of the configured Atrium workspace (id, name, kind).',
      inputSchema: {},
      run: () => service.listBoards(),
    },
    {
      name: 'atrium_get_board',
      description:
        'Read-only. Returns a board: its columns (id, title, type, labels), groups and active items ' +
        '(id, seq, name, group, values keyed by column title, subitems nested).',
      inputSchema: {
        boardId: id,
        includeItems: z.boolean().optional().describe('Default true.'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max items, default 200.'),
      },
      run: (args) => service.getBoard(args),
    },
    {
      name: 'atrium_create_board',
      description:
        'Creates a new board (default Person, Status and Date columns and two groups, no sample items) at the end ' +
        'of the workspace root, owned by the configured user. Additive.',
      inputSchema: {
        name: z.string().trim().min(1).max(120),
        description: z.string().max(1000).optional(),
      },
      run: (args) => service.createBoard(args),
    },
    {
      name: 'atrium_add_group',
      description: 'Adds a group at the end of a board. Needs the board owner role. Additive.',
      inputSchema: {
        boardId: id,
        title: z.string().trim().min(1).max(120),
        color: z.string().optional().describe('#RRGGBB or a name such as blue, green, purple.'),
      },
      run: (args) => service.addGroup(args),
    },
    {
      name: 'atrium_rename_group',
      description: 'Renames a group (found by id or title). Needs the board owner role.',
      inputSchema: { boardId: id, group: ref, title: z.string().trim().min(1).max(120) },
      run: (args) => service.renameGroup(args),
    },
    {
      name: 'atrium_delete_group',
      description:
        'Removes an empty group from the board layout. Refuses while the group still has active items or is the last group.',
      inputSchema: { boardId: id, group: ref },
      run: (args) => service.deleteGroup(args),
    },
    {
      name: 'atrium_add_column',
      description:
        `Adds a column at the end of a board. Types: ${CREATABLE_COLUMN_TYPES.join(', ')}. ` +
        'For status, dropdown and tags pass the labels as settings.addLabels (status: texts or {label,color}). ' +
        "Other settings are the type's own (e.g. rating: {limit, symbol}). Needs the board owner role. Additive.",
      inputSchema: {
        boardId: id,
        title: z.string().trim().min(1).max(120),
        type: z.enum(CREATABLE_COLUMN_TYPES),
        settings: z.record(z.string(), z.unknown()).optional(),
      },
      run: (args) => service.addColumn(args),
    },
    {
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
    },
    {
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
    },
    {
      name: 'atrium_update_item',
      description:
        'Changes an item: name, group (moves it to the end of that group) and/or cell values. Only the given cells ' +
        'change; null clears a cell.',
      inputSchema: {
        boardId: id,
        itemId: id,
        name: z.string().trim().min(1).max(500).optional(),
        group: ref.optional(),
        values: cellValues.optional(),
      },
      run: (args) => service.updateItem(args),
    },
    {
      name: 'atrium_get_item_description',
      description:
        "Read-only. Returns an item's rich-text description as markdown (plus plain text and the names of any " +
        'nodes markdown cannot show, such as images or tables).',
      inputSchema: { boardId: id, itemId: id },
      run: (args) => service.getItemDescription(args),
    },
    {
      name: 'atrium_set_item_description',
      description:
        "Writes an item's description (the rich-text body in the item view) from markdown: headings (#), bold, " +
        'italic, ~~strike~~, `code`, [links](https://...), bullet/numbered/task (- [ ]) lists, > quotes, ``` code blocks and ---. ' +
        'mode "replace" (the default) overwrites; "append" adds to the end. Empty markdown with replace clears it. ' +
        'Refuses to replace a description holding images, tables or mentions unless allowOverwriteRich is true.',
      inputSchema: {
        boardId: id,
        itemId: id,
        markdown: z.string().max(50000),
        mode: z.enum(['replace', 'append']).optional(),
        allowOverwriteRich: z.boolean().optional(),
      },
      run: (args) => service.setItemDescription(args),
    },
    {
      name: 'atrium_archive_item',
      description: 'Archives an item (state archived). Reversible in the Atrium app.',
      inputSchema: { boardId: id, itemId: id },
      run: (args) => service.setItemState({ ...args, state: 'archived' }),
    },
    {
      name: 'atrium_delete_item',
      description:
        "Soft-deletes an item (state deleted, like the app's trash). Never a hard delete; restorable in the app.",
      inputSchema: { boardId: id, itemId: id },
      run: (args) => service.setItemState({ ...args, state: 'deleted' }),
    },
    {
      name: 'atrium_add_update',
      description: "Posts an update (comment) in an item's feed, as the configured user. Additive.",
      inputSchema: { boardId: id, itemId: id, text: z.string().trim().min(1).max(50000) },
      run: (args) => service.addUpdate(args),
    },
  ];
}
