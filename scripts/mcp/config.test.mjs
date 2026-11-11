// The stdio server's environment parsing: the user id is required, the workspace id is an optional
// filter, and only local emulator addresses are accepted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { readConfig } from './lib/config.mjs';

test('config: refuses to start without a user, and only local emulators', () => {
  assert.throws(() => readConfig({}), /ATRIUM_USER_UID is not set/);
  assert.throws(() => readConfig({ ATRIUM_WORKSPACE_ID: 'w' }), /ATRIUM_USER_UID is not set/);
  assert.throws(
    () => readConfig({ ATRIUM_USER_UID: 'u', ATRIUM_EMULATOR: 'example.com:8080' }),
    /not a local address/,
  );
  assert.throws(() => readConfig({ ATRIUM_USER_UID: '../x' }), /plain id/);
  assert.throws(
    () => readConfig({ ATRIUM_USER_UID: 'u', ATRIUM_WORKSPACE_ID: '../x' }),
    /ATRIUM_WORKSPACE_ID is not a plain id/,
  );
});

test('config: the workspace id is an optional filter', () => {
  const all = readConfig({ ATRIUM_USER_UID: 'u' });
  assert.equal(all.uid, 'u');
  assert.equal(all.workspaceFilter, null);
  assert.equal(all.project, 'atrium-board');
  assert.equal(all.database, FIRESTORE_DATABASE_ID);
  assert.equal(all.emulator, null);
  const one = readConfig({ ATRIUM_USER_UID: 'u', ATRIUM_WORKSPACE_ID: ' w1 ' });
  assert.equal(one.workspaceFilter, 'w1');
  const local = readConfig({ ATRIUM_USER_UID: 'u', ATRIUM_EMULATOR: '127.0.0.1:8080' });
  assert.equal(local.emulator, '127.0.0.1:8080');
});
