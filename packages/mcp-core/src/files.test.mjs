// Tests for the files tools (batch 3 PR 1), against the in-memory Firestore and a fake `serverOps`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { defineTools, serverToolNames, toolNamesByDomain } from './tools.mjs';
import { MAX_UPLOAD_BYTES } from './service/files.mjs';

const WS = 'ws1';
const ME = 'user-me'; // workspace owner
const ED = 'user-ed'; // editor
const VW = 'user-vw'; // viewer
const OUT = 'user-out'; // not in the workspace
const NOW = new Date('2026-11-18T10:00:00Z');

const file = (id, name, more = {}) => ({
  id,
  name,
  storagePath: `boards/b1/items/i1/files/${id}`,
  size: 1234,
  mimeType: 'image/png',
  uploadedAt: '2026-11-10T09:00:00.000Z',
  uploadedBy: ED,
  ...more,
});

const board = (more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'main',
  access: { [ME]: 'owner' },
  accessUids: [ME],
  position: 'a0',
  folderId: null,
  name: 'Receipts',
  description: '',
  columns: [
    { id: 'fl', type: 'files', title: 'Scans', position: 'a0', settings: { maxFileSizeMb: 1 } },
    {
      id: 'pdf',
      type: 'files',
      title: 'Contracts',
      position: 'a1',
      settings: { allowedTypes: ['.pdf'] },
    },
    { id: 'tx', type: 'text', title: 'Note', position: 'a2', settings: {} },
  ],
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
  ...more,
});
const item = (name, more = {}) => ({
  name,
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  state: 'active',
  values: {},
  ...more,
});
const post = (authorId, attachments, more = {}) => ({
  authorId,
  content: 'See attached',
  createdAt: new Date('2026-11-11T10:00:00Z'),
  attachments,
  ...more,
});

const baseDocs = () => ({
  [`workspaces/${WS}`]: {
    name: 'Home',
    ownerId: ME,
    roles: { [ME]: 'owner', [ED]: 'member', [VW]: 'viewer' },
    memberIds: [ME, ED, VW],
  },
  [`workspaces/${WS}/members/${ME}`]: { displayName: 'Avery Quinn' },
  [`workspaces/${WS}/members/${ED}`]: { displayName: 'Sam Lee' },
  [`workspaces/${WS}/members/${VW}`]: { displayName: 'Robin Vale' },
  [`users/${ME}`]: { displayName: 'Avery Quinn' },
  'boards/b1': board(),
  'boards/b1/items/i1': item('Slip', {
    updatesCount: 1,
    values: {
      fl: {
        files: [
          file('f1', 'slip.png'),
          file('f2', 'old.png', { uploadedAt: '2026-11-01T09:00:00.000Z' }),
        ],
      },
      pdf: { files: [file('f3', 'lease.pdf', { mimeType: 'application/pdf' })] },
    },
  }),
  'boards/b1/items/i1/updates/u1': post(ED, [file('a1', 'photo.jpg', { mimeType: 'image/jpeg' })], {
    repliesCount: 1,
  }),
  'boards/b1/items/i1/updates/u1/replies/r1': post(ME, [file('a2', 'reply.png')]),
  'boards/b1/items/i2': item('Empty'),
  'boards/b1/items/i3': item('Gone', {
    state: 'deleted',
    values: { fl: { files: [file('x', 'x.png')] } },
  }),
  'boards/b1/items/i4': item('Sub', {
    parentItemId: 'i1',
    values: { fl: { files: [file('s1', 'sub.png')] } },
  }),
  'boards/b1/items/i5': item('Corrupt', { values: { fl: { files: 'nope' } } }),
});

/** A `serverOps` that records its calls and stands in for Cloud Storage. */
function fakeOps() {
  const calls = [];
  return {
    calls,
    async getFileLink(args) {
      calls.push(['getFileLink', args]);
      return { url: 'https://storage.example.com/signed?x=1', expiresAt: NOW.getTime() + 300_000 };
    },
    async uploadFile(args) {
      calls.push(['uploadFile', args]);
      return {
        file: {
          id: 'new1',
          name: args.name,
          size: args.bytes.length,
          mimeType: args.contentType,
          uploadedAt: NOW.toISOString(),
          uploadedBy: args.uid,
        },
        filesInCell: 3,
      };
    },
    async deleteFile(args) {
      calls.push(['deleteFile', args]);
      return { remaining: 1 };
    },
  };
}

function setup(actor = ME, { extra = {}, ops = fakeOps() } = {}) {
  const client = createFakeClient({ ...baseDocs(), ...extra });
  const service = createService({ client, actor: { uid: actor }, now: () => NOW, serverOps: ops });
  const tools = defineTools(service);
  const run = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  return { client, service, tools, run, ops };
}
const b64 = (bytes) => Buffer.alloc(bytes, 7).toString('base64');

// ---- the catalogue ------------------------------------------------------------------------------

test('hosted-only tools are registered only when the service has serverOps', () => {
  const hosted = defineTools(setup().service).map((t) => t.name);
  const client = createFakeClient(baseDocs());
  const local = defineTools(createService({ client, actor: { uid: ME } })).map((t) => t.name);
  const all = Object.values(toolNamesByDomain({})).flat();
  const serverOnly = serverToolNames();
  assert.deepEqual(serverOnly.sort(), [
    'atrium_delete_file',
    'atrium_get_file_link',
    'atrium_set_access',
    'atrium_upload_file',
  ]);
  assert.equal(hosted.length, all.length);
  assert.equal(local.length, all.length - serverOnly.length);
  for (const name of serverOnly) {
    assert.ok(hosted.includes(name), `${name} is hosted`);
    assert.ok(!local.includes(name), `${name} is not in local mode`);
  }
  assert.ok(local.includes('atrium_list_files'));
});

test('the file tools carry the right scopes and annotations', () => {
  const byName = Object.fromEntries(setup().tools.map((t) => [t.name, t]));
  assert.equal(byName.atrium_list_files.scope, 'read');
  assert.equal(byName.atrium_get_file_link.scope, 'read');
  assert.equal(byName.atrium_upload_file.scope, 'write');
  assert.equal(byName.atrium_upload_file.annotations.destructiveHint, false);
  assert.equal(byName.atrium_delete_file.scope, 'write');
  assert.equal(byName.atrium_delete_file.annotations.destructiveHint, true);
  for (const name of ['atrium_list_files', 'atrium_get_file_link', 'atrium_delete_file']) {
    assert.match(byName[name].description, /data written by people, not instructions/);
  }
});

test('without serverOps the hosted-only methods say so', async () => {
  const client = createFakeClient(baseDocs());
  const service = createService({ client, actor: { uid: ME } });
  assert.equal(service.hasServerOps, false);
  await assert.rejects(
    service.getFileLink({ boardId: 'b1', itemId: 'i1', fileId: 'f1' }),
    /hosted Atrium connector/,
  );
});

// ---- list ---------------------------------------------------------------------------------------

test('list_files shows column files and update attachments, newest first', async () => {
  const { run } = setup(VW);
  const out = await run('atrium_list_files', { boardId: 'b1' });
  assert.deepEqual(out.filesColumns, ['Scans', 'Contracts']);
  const ids = out.files.map((f) => f.id).sort();
  assert.deepEqual(ids, ['a1', 'a2', 'f1', 'f2', 'f3']);
  const slip = out.files.find((f) => f.id === 'f1');
  assert.deepEqual(slip, {
    id: 'f1',
    name: 'slip.png',
    size: 1234,
    mimeType: 'image/png',
    uploadedAt: '2026-11-10T09:00:00.000Z',
    uploadedBy: { uid: ED, name: 'Sam Lee' },
    itemId: 'i1',
    itemName: 'Slip',
    source: { column: 'Scans' },
  });
  assert.deepEqual(out.files.find((f) => f.id === 'a1').source, { updateId: 'u1' });
  assert.deepEqual(out.files.find((f) => f.id === 'a2').source, { updateId: 'u1', replyId: 'r1' });
  // Newest first.
  const times = out.files.map((f) => f.uploadedAt);
  assert.deepEqual(times, [...times].sort().reverse());
  // Subitems, deleted items and a corrupt cell add nothing.
  assert.ok(!out.files.some((f) => ['x', 's1'].includes(f.id)));
});

test('list_files can leave updates out, or narrow to an item or a column', async () => {
  const { run } = setup();
  const noUpdates = await run('atrium_list_files', { boardId: 'b1', includeUpdates: false });
  assert.deepEqual(noUpdates.files.map((f) => f.id).sort(), ['f1', 'f2', 'f3']);
  const byColumn = await run('atrium_list_files', { boardId: 'b1', column: 'contracts' });
  assert.deepEqual(
    byColumn.files.map((f) => f.id),
    ['f3'],
  );
  const empty = await run('atrium_list_files', { boardId: 'b1', itemId: 'i2' });
  assert.deepEqual(empty.files, []);
  const one = await run('atrium_list_files', { boardId: 'b1', itemId: 'i1' });
  assert.equal(one.total, 5);
  await assert.rejects(
    run('atrium_list_files', { boardId: 'b1', column: 'Note' }),
    /not a Files column/,
  );
  await assert.rejects(run('atrium_list_files', { boardId: 'b1', itemId: 'i3' }), /not found/);
});

test('list_files treats a board outside the memberships as not found', async () => {
  const { run } = setup(OUT);
  await assert.rejects(run('atrium_list_files', { boardId: 'b1' }), /not found/);
});

test('list_files skips the update scan for items without updates', async () => {
  const { client, run } = setup();
  const reads = [];
  const listAll = client.listAllDocs.bind(client);
  client.listAllDocs = (path, options) => {
    reads.push(path);
    return listAll(path, options);
  };
  await run('atrium_list_files', { boardId: 'b1' });
  assert.deepEqual(reads.filter((p) => p.includes('/updates')).sort(), [
    'boards/b1/items/i1/updates',
    'boards/b1/items/i1/updates/u1/replies',
  ]);
});

// ---- link ---------------------------------------------------------------------------------------

test('get_file_link returns a signed link for a column file and an update file', async () => {
  const { run, ops } = setup(VW);
  const link = await run('atrium_get_file_link', { boardId: 'b1', itemId: 'i1', fileId: 'f1' });
  assert.equal(link.url, 'https://storage.example.com/signed?x=1');
  assert.equal(link.file.name, 'slip.png');
  assert.deepEqual(link.source, { column: 'Scans' });
  assert.equal(link.expiresAt, '2026-11-18T10:05:00.000Z');
  assert.deepEqual(ops.calls[0], [
    'getFileLink',
    { uid: VW, boardId: 'b1', itemId: 'i1', fileId: 'f1', columnId: 'fl' },
  ]);
  const reply = await run('atrium_get_file_link', { boardId: 'b1', itemId: 'i1', fileId: 'a2' });
  assert.deepEqual(reply.source, { updateId: 'u1', replyId: 'r1' });
  assert.deepEqual(ops.calls[1][1], {
    uid: VW,
    boardId: 'b1',
    itemId: 'i1',
    fileId: 'a2',
    updateId: 'u1',
    replyId: 'r1',
  });
});

test('get_file_link: another column, an unknown file or an unreadable board', async () => {
  const { run, ops } = setup();
  await assert.rejects(
    run('atrium_get_file_link', { boardId: 'b1', itemId: 'i1', fileId: 'f1', column: 'Contracts' }),
    /was not found on this item/,
  );
  await assert.rejects(
    run('atrium_get_file_link', { boardId: 'b1', itemId: 'i1', fileId: 'nope' }),
    /was not found on this item/,
  );
  await assert.rejects(
    run('atrium_get_file_link', { boardId: 'b1', itemId: 'i3', fileId: 'x' }),
    /Item "i3" was not found/,
  );
  assert.equal(ops.calls.length, 0);
  const out = setup(OUT);
  await assert.rejects(
    out.run('atrium_get_file_link', { boardId: 'b1', itemId: 'i1', fileId: 'f1' }),
    /Board "b1" was not found/,
  );
  assert.equal(out.ops.calls.length, 0);
});

// ---- upload -------------------------------------------------------------------------------------

test('upload_file saves a 300 KB image through serverOps', async () => {
  const { run, ops } = setup(ED);
  const out = await run('atrium_upload_file', {
    boardId: 'b1',
    itemId: 'i2',
    column: 'Scans',
    name: 'permission-slip.png',
    contentType: 'image/png',
    dataBase64: b64(300 * 1024),
  });
  assert.equal(out.column, 'Scans');
  assert.equal(out.file.id, 'new1');
  assert.equal(out.file.size, 300 * 1024);
  assert.equal(out.filesInCell, 3);
  const [name, args] = ops.calls[0];
  assert.equal(name, 'uploadFile');
  assert.equal(args.uid, ED);
  assert.equal(args.columnId, 'fl');
  assert.equal(args.bytes.length, 300 * 1024);
  assert.ok(!JSON.stringify(out).includes(b64(64)), 'the bytes are not echoed');
});

test('upload_file refuses too large, empty, malformed and wrongly typed files', async () => {
  const { run, ops } = setup(ED);
  const base = {
    boardId: 'b1',
    itemId: 'i2',
    column: 'Scans',
    name: 'a.png',
    contentType: 'image/png',
  };
  await assert.rejects(
    run('atrium_upload_file', { ...base, dataBase64: b64(600 * 1024) }),
    /up to 512 KB.*Upload larger files in Atrium/,
  );
  assert.ok(MAX_UPLOAD_BYTES === 512 * 1024);
  await run('atrium_upload_file', { ...base, dataBase64: b64(MAX_UPLOAD_BYTES) });
  await assert.rejects(
    run('atrium_upload_file', { ...base, dataBase64: b64(MAX_UPLOAD_BYTES + 1) }),
    /512 KB/,
  );
  await assert.rejects(run('atrium_upload_file', { ...base, dataBase64: '' }), /base64/);
  await assert.rejects(run('atrium_upload_file', { ...base, dataBase64: 'not base64!' }), /base64/);
  await assert.rejects(
    run('atrium_upload_file', { ...base, contentType: 'image', dataBase64: b64(10) }),
    /contentType/,
  );
  await assert.rejects(
    run('atrium_upload_file', { ...base, name: '../x.png', dataBase64: b64(10) }),
    /slash/,
  );
  await assert.rejects(
    run('atrium_upload_file', {
      ...base,
      column: 'Contracts',
      dataBase64: b64(10),
    }),
    /does not allow this file type/,
  );
  assert.equal(ops.calls.length, 1, 'only the file at the limit was saved');
});

test('upload_file uses the only Files column by default', async () => {
  const board1mb = board({
    columns: [
      { id: 'fl', type: 'files', title: 'Scans', position: 'a0', settings: { maxFileSizeMb: 1 } },
    ],
  });
  const { run } = setup(ED, { extra: { 'boards/b1': board1mb } });
  // The column's own limit is at least 1 MB, so the connector's 512 KB limit always binds first.
  const out = await run('atrium_upload_file', {
    boardId: 'b1',
    itemId: 'i2',
    name: 'a.png',
    contentType: 'image/png',
    dataBase64: b64(1024),
  });
  assert.equal(out.column, 'Scans', 'the only Files column is the default');
});

test('upload_file needs a Files column, and a name when there are several', async () => {
  const { run } = setup(ED);
  const args = {
    boardId: 'b1',
    itemId: 'i2',
    name: 'a.pdf',
    contentType: 'application/pdf',
    dataBase64: b64(9),
  };
  await assert.rejects(
    run('atrium_upload_file', args),
    /Name the Files column.*"Scans", "Contracts"/,
  );
  await assert.rejects(
    run('atrium_upload_file', { ...args, column: 'Note' }),
    /not a Files column/,
  );
  const none = setup(ED, { extra: { 'boards/b1': board({ columns: [] }) } });
  await assert.rejects(none.run('atrium_upload_file', args), /no Files column/);
});

test('upload_file: a viewer, a locked column and an archived item are refused', async () => {
  const args = {
    boardId: 'b1',
    itemId: 'i2',
    column: 'Scans',
    name: 'a.png',
    contentType: 'image/png',
    dataBase64: b64(9),
  };
  const viewer = setup(VW);
  await assert.rejects(viewer.run('atrium_upload_file', args), /only view/);
  const locked = setup(ED, { extra: { 'boards/b1': board({ columnLocks: ['fl'] }) } });
  await assert.rejects(locked.run('atrium_upload_file', args), /locked to board owners/);
  const owner = setup(ME, { extra: { 'boards/b1': board({ columnLocks: ['fl'] }) } });
  await owner.run('atrium_upload_file', args);
  const archived = setup(ED, {
    extra: { 'boards/b1/items/i2': item('Empty', { state: 'archived' }) },
  });
  await assert.rejects(archived.run('atrium_upload_file', args), /archived/);
  for (const t of [viewer, locked, archived]) assert.equal(t.ops.calls.length, 0);
});

test('upload_file refuses a cell that already holds 100 files', async () => {
  const many = Array.from({ length: 100 }, (_, n) => file(`m${n}`, `m${n}.png`));
  const { run, ops } = setup(ED, {
    extra: { 'boards/b1/items/i2': item('Empty', { values: { fl: { files: many } } }) },
  });
  await assert.rejects(
    run('atrium_upload_file', {
      boardId: 'b1',
      itemId: 'i2',
      column: 'Scans',
      name: 'a.png',
      contentType: 'image/png',
      dataBase64: b64(9),
    }),
    /at most 100 files/,
  );
  assert.equal(ops.calls.length, 0);
});

// ---- delete -------------------------------------------------------------------------------------

test('delete_file removes a column file and returns what was deleted', async () => {
  const { run, ops } = setup(ED);
  const out = await run('atrium_delete_file', { boardId: 'b1', itemId: 'i1', fileId: 'f2' });
  assert.deepEqual(out.deleted, {
    id: 'f2',
    name: 'old.png',
    size: 1234,
    mimeType: 'image/png',
    uploadedAt: '2026-11-01T09:00:00.000Z',
    uploadedBy: ED,
    source: { column: 'Scans' },
  });
  assert.equal(out.remaining, 1);
  assert.deepEqual(ops.calls[0][1], {
    uid: ED,
    boardId: 'b1',
    itemId: 'i1',
    fileId: 'f2',
    columnId: 'fl',
  });
});

test('delete_file on an update attachment: the author or a board owner only', async () => {
  const args = { boardId: 'b1', itemId: 'i1', fileId: 'a2' }; // attached to a reply by ME
  const editor = setup(ED);
  await assert.rejects(editor.run('atrium_delete_file', args), /author or a board owner/);
  assert.equal(editor.ops.calls.length, 0);
  const author = setup(ME);
  const out = await author.run('atrium_delete_file', args);
  assert.deepEqual(out.deleted.source, { updateId: 'u1', replyId: 'r1' });
  assert.equal(author.ops.calls[0][1].replyId, 'r1');
  // a1 is Sam's own: Sam may remove it.
  const own = setup(ED);
  await own.run('atrium_delete_file', { boardId: 'b1', itemId: 'i1', fileId: 'a1' });
  assert.equal(own.ops.calls.length, 1);
});

test('delete_file: viewer, locked column and unknown file are refused', async () => {
  const args = { boardId: 'b1', itemId: 'i1', fileId: 'f1' };
  const viewer = setup(VW);
  await assert.rejects(viewer.run('atrium_delete_file', args), /only view/);
  const locked = setup(ED, { extra: { 'boards/b1': board({ columnLocks: ['fl'] }) } });
  await assert.rejects(locked.run('atrium_delete_file', args), /locked to board owners/);
  const { run, ops } = setup(ED);
  await assert.rejects(
    run('atrium_delete_file', { ...args, fileId: 'zzz' }),
    /was not found on this item/,
  );
  assert.equal(ops.calls.length + viewer.ops.calls.length + locked.ops.calls.length, 0);
});
