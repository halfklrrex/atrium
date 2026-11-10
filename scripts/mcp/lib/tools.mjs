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
        '(id, seq, name, group, values keyed by column title, subitems nested), and the subitem columns.',
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
        'Changes an item or subitem: name, group (items only; moves it, with its subitems, to the end of that group) and/or cell values ' +
        '(a subitem uses the subitem columns). Only the given cells change; null clears a cell.',
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
      description:
        'Archives an item or subitem (state archived; an item takes its subitems along). Reversible in the Atrium app.',
      inputSchema: { boardId: id, itemId: id },
      run: (args) => service.setItemState({ ...args, state: 'archived' }),
    },
    {
      name: 'atrium_delete_item',
      description:
        "Soft-deletes an item or subitem (state deleted, like the app's trash; an item takes its subitems along). Never a hard delete; restorable in the app.",
      inputSchema: { boardId: id, itemId: id },
      run: (args) => service.setItemState({ ...args, state: 'deleted' }),
    },
    {
      name: 'atrium_list_updates',
      description:
        "Read-only. Lists an item's updates (comments), newest first, with their replies: id, author, text, markdown, " +
        'time, whether it was edited, likes, mentioned uids and attachment metadata (name, size, type; files are not downloadable here). ' +
        '"mine" marks posts the configured user can edit or delete.',
      inputSchema: {
        boardId: id,
        itemId: id,
        limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
        includeReplies: z.boolean().optional().describe('Default true.'),
      },
      run: (args) => service.listUpdates(args),
    },
    {
      name: 'atrium_add_update',
      description:
        "Posts an update (comment) in an item's or subitem's feed, as the configured user. The text is markdown " +
        '(bold, italic, links, lists, quotes, code). Mention a workspace member with @[Name] (display name, email or uid; ' +
        '@[me] for yourself): it becomes an @ chip and notifies them. Additive.',
      inputSchema: { boardId: id, itemId: id, text: z.string().trim().min(1).max(50000) },
      run: (args) => service.addUpdate(args),
    },
    {
      name: 'atrium_add_reply',
      description:
        'Replies to an update in its thread, as the configured user. Same markdown and @[Name] mentions as atrium_add_update. Additive.',
      inputSchema: {
        boardId: id,
        itemId: id,
        updateId: id,
        text: z.string().trim().min(1).max(50000),
      },
      run: (args) => service.addReply(args),
    },
    {
      name: 'atrium_edit_update',
      description:
        "Edits the text of one of the configured user's own updates, or of a reply when replyId is given. " +
        'Mentions cannot change after posting: @[Name] is kept as plain @Name text and notifies nobody. Refuses posts with attachments.',
      inputSchema: {
        boardId: id,
        itemId: id,
        updateId: id,
        replyId: id.optional(),
        text: z.string().trim().min(1).max(50000),
      },
      run: (args) => service.editUpdate(args),
    },
    {
      name: 'atrium_delete_update',
      description:
        "Deletes one of the configured user's own updates, or a reply when replyId is given (a hard delete, like the app's). " +
        "Other people's posts are refused.",
      inputSchema: { boardId: id, itemId: id, updateId: id, replyId: id.optional() },
      run: (args) => service.deleteUpdate(args),
    },
    {
      name: 'atrium_list_subitems',
      description:
        "Read-only. Lists an item's subitems (id, name, values keyed by subitem column title) and the board's subitem columns. " +
        "A subitem's id works with atrium_update_item, atrium_get/set_item_description, atrium_add_update, atrium_archive_item and the other item tools.",
      inputSchema: { boardId: id, itemId: id },
      run: (args) => service.listSubitems(args),
    },
    {
      name: 'atrium_create_subitems',
      description:
        `Creates up to ${MAX_ITEMS_PER_CALL} subitems under a top-level item, after its existing subitems, in the parent's group. ` +
        'Values are keyed by subitem column title or id (see atrium_get_board subitemColumns). ' +
        "A board with no subitem columns yet gets monday's defaults (Owner, Status, Date), which needs the board owner role. Additive.",
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
    },
    {
      name: 'atrium_duplicate_item',
      description:
        'Copies an item (or a subitem) next to the original as "Name (copy)", with its cell values and, for an item, its active subitems. ' +
        'Calculated and server-managed cells, descriptions and updates are not copied. Additive.',
      inputSchema: { boardId: id, itemId: id },
      run: (args) => service.duplicateItem(args),
    },
    {
      name: 'atrium_get_activity',
      description:
        "Read-only. The board's recent activity log (newest first), optionally only for one item and its subitems: " +
        'kind, actor, time, item, column, old and new value text. Entries expire after 90 days.',
      inputSchema: {
        boardId: id,
        itemId: id.optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 30.'),
      },
      run: (args) => service.getActivity(args),
    },
    {
      name: 'atrium_list_members',
      description:
        'Read-only. Lists workspace members (uid, name, email, role); with boardId only those who can see that board. ' +
        'Use the uids in People cells and the names in @[Name] mentions.',
      inputSchema: { boardId: id.optional() },
      run: (args) => service.listMembers(args),
    },
  ];
}
