// The tool catalogue: names, descriptions, input schemas, scope and MCP annotations, bound to the
// service. The transports (`scripts/mcp/atrium-mcp.mjs`, the hosted Function) only register these, so
// the list is testable without a transport. Every tool carries `scope: 'read' | 'write'`: the hosted
// server refuses write tools on a read-only connection, and the stdio server ignores it.
//
// The catalogue is split by domain (`tools/<domain>.mjs`, each a function of the service returning its
// tools); a new domain is one file and one line in `DOMAINS`. The original 45 tools keep the order
// they were registered in (`LEGACY_ORDER`); every later tool follows them in `DOMAINS` order.
import { boardTools } from './tools/boards.mjs';
import { itemTools } from './tools/items.mjs';
import { memberTools } from './tools/members.mjs';
import { myWorkTools } from './tools/mywork.mjs';
import { updateTools } from './tools/updates.mjs';

/** One function per domain file: `(service) => tool[]`. */
export const DOMAINS = {
  boards: boardTools,
  items: itemTools,
  updates: updateTools,
  members: memberTools,
  mywork: myWorkTools,
};

/** The registration order of the tools that existed before the split (a parity test pins it). */
const LEGACY_ORDER = [
  'atrium_list_workspaces',
  'atrium_list_boards',
  'atrium_get_board',
  'atrium_list_templates',
  'atrium_create_board',
  'atrium_add_group',
  'atrium_rename_group',
  'atrium_delete_group',
  'atrium_add_column',
  'atrium_update_column_settings',
  'atrium_rename_column',
  'atrium_delete_column',
  'atrium_reorder_columns',
  'atrium_lock_column',
  'atrium_unlock_column',
  'atrium_create_items',
  'atrium_update_item',
  'atrium_get_item_description',
  'atrium_set_item_description',
  'atrium_archive_item',
  'atrium_delete_item',
  'atrium_list_updates',
  'atrium_add_update',
  'atrium_add_reply',
  'atrium_edit_update',
  'atrium_delete_update',
  'atrium_list_subitems',
  'atrium_create_subitems',
  'atrium_duplicate_item',
  'atrium_move_item_to_board',
  'atrium_get_activity',
  'atrium_find_items',
  'atrium_restore_item',
  'atrium_move_item',
  'atrium_reorder_groups',
  'atrium_like_update',
  'atrium_unlike_update',
  'atrium_vote_item',
  'atrium_unvote_item',
  'atrium_rename_board',
  'atrium_archive_board',
  'atrium_delete_board',
  'atrium_restore_board',
  'atrium_find_member',
  'atrium_list_members',
];

export function defineTools(service) {
  const tools = Object.values(DOMAINS).flatMap((domain) => domain(service));
  const rank = (tool) => {
    const at = LEGACY_ORDER.indexOf(tool.name);
    return at < 0 ? Infinity : at;
  };
  // Array#sort is stable, so tools outside the legacy list keep their domain order after it.
  return tools.sort((a, b) => rank(a) - rank(b));
}

/** Tool names per domain file (the count tests and the docs read this, not a literal number). */
export function toolNamesByDomain(service = {}) {
  return Object.fromEntries(
    Object.entries(DOMAINS).map(([domain, make]) => [
      domain,
      make(service).map((tool) => tool.name),
    ]),
  );
}
