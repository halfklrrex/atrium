// Spawns the real server over stdio (pointed at a local, unused emulator address, so it can never
// reach production) and checks `tools/list`, and that it exits without configuration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = resolve(root, 'scripts/mcp/atrium-mcp.mjs');

const EXPECTED = [
  'atrium_add_column',
  'atrium_add_group',
  'atrium_add_update',
  'atrium_archive_item',
  'atrium_create_board',
  'atrium_create_items',
  'atrium_delete_group',
  'atrium_delete_item',
  'atrium_get_board',
  'atrium_get_item_description',
  'atrium_list_boards',
  'atrium_rename_group',
  'atrium_set_item_description',
  'atrium_update_column_settings',
  'atrium_update_item',
];

test('the server lists its tools over stdio', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', entry],
    cwd: root,
    env: {
      ...process.env,
      ATRIUM_WORKSPACE_ID: 'test-workspace',
      ATRIUM_USER_UID: 'test-user',
      ATRIUM_EMULATOR: '127.0.0.1:1', // nothing listens here
    },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED);
    const createItems = tools.find((t) => t.name === 'atrium_create_items');
    assert.deepEqual(createItems.inputSchema.required.sort(), ['boardId', 'items']);
  } finally {
    await client.close();
  }
});

test('without ATRIUM_WORKSPACE_ID the server exits with a clear message and writes nothing', () => {
  const env = { ...process.env, ATRIUM_EMULATOR: '127.0.0.1:1' };
  delete env.ATRIUM_WORKSPACE_ID;
  delete env.ATRIUM_USER_UID;
  const result = spawnSync(process.execPath, ['--import', 'tsx', entry], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ATRIUM_WORKSPACE_ID is not set/);
  assert.equal(result.stdout, '');
});
