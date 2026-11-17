// Pins the tool catalogue: the 45 tools that existed before the module split keep their names, order,
// scopes, annotations, descriptions and input schemas (`tools-snapshot.json`, generated from the
// pre-split catalogue). New tools may be added after them; changing a snapshot entry is deliberate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { defineTools } from './tools.mjs';
import { toolNamesByDomain } from './tools.mjs';

const snapshot = JSON.parse(
  readFileSync(new URL('./tools-snapshot.json', import.meta.url), 'utf8'),
);
const tools = defineTools({});

test('the legacy tools keep their names and order, new tools come after them', () => {
  assert.deepEqual(
    tools.slice(0, snapshot.length).map((t) => t.name),
    snapshot.map((t) => t.name),
  );
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, 'tool names are unique');
});

test('every legacy tool keeps its scope, annotations, description and input schema', () => {
  for (const expected of snapshot) {
    const tool = tools.find((t) => t.name === expected.name);
    assert.ok(tool, `${expected.name} is registered`);
    assert.deepEqual(
      {
        name: tool.name,
        scope: tool.scope,
        annotations: tool.annotations,
        description: tool.description,
        inputSchema: z.toJSONSchema(z.object(tool.inputSchema), { io: 'input' }),
      },
      expected,
      expected.name,
    );
  }
});

/** One asserted list per domain file: adding a tool to a file means adding its name here. */
const DOMAIN_TOOLS = {
  boards: [
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
    'atrium_reorder_groups',
    'atrium_rename_board',
    'atrium_archive_board',
    'atrium_delete_board',
    'atrium_restore_board',
  ],
  items: [
    'atrium_create_items',
    'atrium_update_item',
    'atrium_get_item_description',
    'atrium_set_item_description',
    'atrium_archive_item',
    'atrium_delete_item',
    'atrium_list_subitems',
    'atrium_create_subitems',
    'atrium_duplicate_item',
    'atrium_move_item_to_board',
    'atrium_get_activity',
    'atrium_find_items',
    'atrium_restore_item',
    'atrium_move_item',
    'atrium_vote_item',
    'atrium_unvote_item',
  ],
  updates: [
    'atrium_list_updates',
    'atrium_add_update',
    'atrium_add_reply',
    'atrium_edit_update',
    'atrium_delete_update',
    'atrium_like_update',
    'atrium_unlike_update',
  ],
  members: ['atrium_find_member', 'atrium_list_members', 'atrium_list_teams'],
  teams: ['atrium_create_team', 'atrium_update_team', 'atrium_delete_team'],
  mywork: [
    'atrium_my_work',
    'atrium_search',
    'atrium_list_notifications',
    'atrium_mark_notifications_read',
  ],
  docs: [
    'atrium_list_docs',
    'atrium_get_doc',
    'atrium_create_doc',
    'atrium_write_doc',
    'atrium_rename_doc',
    'atrium_delete_doc',
    'atrium_restore_doc',
  ],
  views: [
    'atrium_list_views',
    'atrium_get_view_items',
    'atrium_create_view',
    'atrium_update_view',
    'atrium_delete_view',
  ],
};

test('every domain file lists exactly the tools asserted here, and every tool is in one file', () => {
  const byDomain = toolNamesByDomain({});
  assert.deepEqual(byDomain, DOMAIN_TOOLS);
  assert.deepEqual(Object.values(byDomain).flat().sort(), tools.map((t) => t.name).sort());
});
