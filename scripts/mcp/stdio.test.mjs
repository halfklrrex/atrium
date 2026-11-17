// Spawns the real server over stdio (pointed at a local, unused emulator address, so it can never
// reach production) and checks `tools/list`, and that it exits without configuration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { toolNamesByDomain } from '@atrium/mcp-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entry = resolve(root, 'scripts/mcp/atrium-mcp.mjs');

/** Every tool the catalogue defines (read from the domain files; no literal count or name list here). */
const EXPECTED = Object.values(toolNamesByDomain({})).flat().sort();
test('the server lists its tools over stdio', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', entry],
    cwd: root,
    env: {
      ...process.env,
      ATRIUM_USER_UID: 'test-user',
      ATRIUM_EMULATOR: '127.0.0.1:1', // nothing listens here
    },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, EXPECTED.length);
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED);
    const createItems = tools.find((t) => t.name === 'atrium_create_items');
    assert.deepEqual(createItems.inputSchema.required.sort(), ['boardId', 'items']);
    const listBoards = tools.find((t) => t.name === 'atrium_list_boards');
    assert.deepEqual(listBoards.inputSchema.required ?? [], []);
    assert.equal(listBoards.annotations.readOnlyHint, true);
    assert.equal(createItems.annotations.readOnlyHint, false);
  } finally {
    await client.close();
  }
});

test('without ATRIUM_USER_UID the server exits with a clear message and writes nothing', () => {
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
  assert.match(result.stderr, /ATRIUM_USER_UID is not set/);
  assert.equal(result.stdout, '');
});
