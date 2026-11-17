// Batch 2 PR 2: the Docs tools (list, get, create, write, rename, delete, restore), the table and
// mention conversion they share with item descriptions. In-memory Firestore only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docBodySchema } from '@atrium/shared';
import { docToMarkdown, markdownToDoc, richNodeTypes } from './description.mjs';
import { ts } from './builders.mjs';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { defineTools } from './tools.mjs';

const WS = 'ws1';
const ME = 'user-me';
const JORDAN = 'user-jordan';
const SAM = 'user-sam';
const VIEWER = 'user-viewer';
const NOW = new Date('2026-11-01T10:00:00Z');
const LONG_AGO = new Date('2026-10-30T08:15:00Z');

const docMeta = (more = {}) => ({
  workspaceId: WS,
  folderId: null,
  name: 'Packing list',
  kind: 'main',
  access: { [ME]: 'owner' },
  accessUids: [ME],
  position: 'a5',
  icon: null,
  state: 'active',
  deletedAt: null,
  createdAt: LONG_AGO,
  createdBy: ME,
  updatedAt: LONG_AGO,
  ...more,
});

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const body = (doc, more = {}) => ({
  doc,
  text: 'x',
  rev: 3,
  updatedAt: LONG_AGO,
  updatedBy: JORDAN,
  ...more,
});

function setup({ actor = ME, extra = {}, now = NOW } = {}) {
  const client = createFakeClient({
    [`workspaces/${WS}`]: {
      name: 'Home',
      ownerId: ME,
      roles: { [ME]: 'owner', [JORDAN]: 'member', [SAM]: 'member', [VIEWER]: 'viewer' },
      memberIds: [ME, JORDAN, SAM, VIEWER],
    },
    [`users/${ME}`]: { displayName: 'Avery Quinn' },
    [`workspaces/${WS}/members/${ME}`]: { displayName: 'Avery Quinn', email: 'avery@example.com' },
    [`workspaces/${WS}/members/${JORDAN}`]: {
      displayName: 'Jordan Lee',
      email: 'jordan@example.com',
    },
    [`workspaces/${WS}/members/${SAM}`]: { displayName: 'Sam Reed', email: 'sam@example.com' },
    [`workspaces/${WS}/members/${VIEWER}`]: { displayName: 'Vic Ward', email: 'vic@example.com' },
    'boards/b1': {
      workspaceId: WS,
      folderId: null,
      position: 'a3',
      name: 'B',
      kind: 'main',
      state: 'active',
      access: {},
    },
    'dashboards/d1': { workspaceId: WS, folderId: null, position: 'a8', name: 'D' },
    ...extra,
  });
  const service = createService({ client, actor: { uid: actor }, now: () => now });
  const tools = defineTools(service);
  const run = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  return { client, service, tools, run };
}

/** The body as the web would read it (Firestore timestamps), parsed with the shared schema. */
const parsesAsBody = (saved) =>
  docBodySchema.safeParse({ ...saved, updatedAt: ts(saved.updatedAt) }).success;

const rejects = (promise, pattern) => assert.rejects(promise, pattern);

test('list: main docs, private docs only with access, trash by state', async () => {
  const { run } = setup({
    extra: {
      'docs/main1': docMeta({ name: 'Main', position: 'a2', access: {}, accessUids: [JORDAN] }),
      'docs/mine': docMeta({ name: 'Mine', kind: 'private', position: 'a1' }),
      'docs/hidden': docMeta({
        name: 'Hidden',
        kind: 'private',
        access: { [JORDAN]: 'owner' },
        accessUids: [JORDAN],
      }),
      'docs/shared': docMeta({
        name: 'Shared',
        kind: 'shareable',
        position: 'a3',
        access: { [JORDAN]: 'owner', [ME]: 'viewer' },
        accessUids: [JORDAN, ME],
      }),
      'docs/old': docMeta({ name: 'Old', state: 'deleted', position: 'a4' }),
    },
  });
  const active = await run('atrium_list_docs', {});
  assert.deepEqual(
    active.docs.map((d) => [d.name, d.role, d.state]),
    [
      ['Mine', 'owner', 'active'],
      ['Main', 'owner', 'active'],
      ['Shared', 'viewer', 'active'],
    ],
  );
  assert.equal(active.docs[0].updatedAt, LONG_AGO.toISOString());
  const trash = await run('atrium_list_docs', { state: 'deleted' });
  assert.deepEqual(
    trash.docs.map((d) => d.name),
    ['Old'],
  );
});

test('list: a workspace the actor is not in reads as not found', async () => {
  const { run } = setup({ actor: 'user-stranger' });
  await rejects(run('atrium_list_docs', { workspaceId: WS }), /not found among your workspaces/);
});

test('get: markdown with a table, a mention and an image placeholder', async () => {
  const doc = {
    type: 'doc',
    content: [
      para('Intro'),
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [para('Item')] },
              { type: 'tableHeader', content: [para('Qty')] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [para('Socks | pairs')] },
              { type: 'tableCell', content: [para('3')] },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ask ' },
          { type: 'mention', attrs: { id: SAM, label: 'Sam Reed' } },
          { type: 'image', attrs: { fileId: 'f1', alt: 'map' } },
        ],
      },
    ],
  };
  const { run } = setup({
    extra: { 'docs/d': docMeta(), 'docs/d/content/body': body(doc, { rev: 4 }) },
  });
  const got = await run('atrium_get_doc', { docId: 'd' });
  assert.equal(got.rev, 4);
  assert.equal(got.updatedBy, 'Jordan Lee');
  assert.equal(got.role, 'owner');
  assert.equal(
    got.markdown,
    [
      'Intro',
      '| Item | Qty |\n| --- | --- |\n| Socks \\| pairs | 3 |',
      'Ask @[Sam Reed]![map](atrium-doc-image:f1)',
    ].join('\n\n'),
  );
  assert.deepEqual(got.richNodes, ['image']);
});

test('get: a doc without a body reads empty with rev 0; a trashed or foreign doc is refused', async () => {
  const { run } = setup({
    extra: {
      'docs/d': docMeta(),
      'docs/gone': docMeta({ state: 'deleted' }),
      'docs/other': docMeta({
        kind: 'private',
        access: { [JORDAN]: 'owner' },
        accessUids: [JORDAN],
      }),
    },
  });
  const got = await run('atrium_get_doc', { docId: 'd' });
  assert.deepEqual([got.rev, got.markdown, got.text, got.richNodes], [0, '', '', []]);
  await rejects(run('atrium_get_doc', { docId: 'gone' }), /is in the trash/);
  await rejects(run('atrium_get_doc', { docId: 'other' }), /was not found in your workspaces/);
  await rejects(run('atrium_get_doc', { docId: 'nope' }), /was not found in your workspaces/);
});

test('create: mirrors the web (owner only, root end, kind) with and without markdown', async () => {
  const { run, client } = setup();
  const plain = await run('atrium_create_doc', { name: '  Trip  ' });
  const stored = await client.getDoc(`docs/${plain.id}`);
  const { position: rootPosition, ...withoutPosition } = stored;
  assert.deepEqual(withoutPosition, {
    workspaceId: WS,
    folderId: null,
    name: 'Trip',
    kind: 'main',
    access: { [ME]: 'owner' },
    accessUids: [ME],
    icon: null,
    state: 'active',
    deletedAt: null,
    createdAt: NOW,
    createdBy: ME,
    updatedAt: NOW,
  });
  assert.ok(rootPosition > 'a8', 'after the last root position among boards and dashboards');
  assert.equal(await client.getDoc(`docs/${plain.id}/content/body`), null);

  const withText = await run('atrium_create_doc', {
    name: 'Notes',
    kind: 'private',
    markdown: '# Hi\n\n| a | b |\n|---|---|\n| 1 | 2 |',
  });
  assert.equal(withText.rev, 1);
  const saved = await client.getDoc(`docs/${withText.id}/content/body`);
  assert.equal(saved.rev, 1);
  assert.equal(saved.updatedBy, ME);
  assert.ok(parsesAsBody(saved));
  assert.equal((await client.getDoc(`docs/${withText.id}`)).kind, 'private');
  assert.ok((await client.getDoc(`docs/${withText.id}`)).position > rootPosition);
  // both writes are one commit
  assert.equal(client.commits.at(-1).length, 2);
});

test('create: the viewer workspace role is refused; names are limited', async () => {
  const { run } = setup({ actor: VIEWER });
  await rejects(run('atrium_create_doc', { name: 'X' }), /needs the member role or higher/);
  const owner = setup();
  await rejects(owner.run('atrium_create_doc', { name: 'x'.repeat(81) }), /1 to 80/);
});

test('write: replace bumps rev, builds a table and mention chips, never writes outside the body', async () => {
  const { run, client } = setup({
    extra: {
      'docs/d': docMeta(),
      'docs/d/content/body': body(
        { type: 'doc', content: [para('old')] },
        { rev: 2, updatedBy: ME },
      ),
    },
  });
  const result = await run('atrium_write_doc', {
    docId: 'd',
    markdown: 'Bring: @[Sam Reed]\n\n| Item | Qty |\n| --- | --- |\n| Socks | 3 |',
    baseRev: 2,
  });
  assert.deepEqual([result.rev, result.mode, result.mentioned], [3, 'replace', 1]);
  const saved = await client.getDoc('docs/d/content/body');
  assert.equal(saved.rev, 3);
  assert.equal(saved.updatedBy, ME);
  assert.ok(parsesAsBody(saved));
  assert.deepEqual(saved.doc.content[0].content[1], {
    type: 'mention',
    attrs: { id: SAM, label: 'Sam Reed' },
  });
  const table = saved.doc.content[1];
  assert.equal(table.type, 'table');
  assert.deepEqual(
    table.content.map((row) => row.content.map((cell) => cell.type)),
    [
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
    ],
  );
  assert.deepEqual(table.content[0].content[0], {
    type: 'tableHeader',
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [para('Item')],
  });
  assert.equal(saved.text, 'Bring: @Sam Reed\nItem\nQty\nSocks\n3');
  // tables and mentions are round-trip content now
  assert.deepEqual(richNodeTypes(saved.doc), []);
  assert.equal(
    docToMarkdown(saved.doc),
    'Bring: @[Sam Reed]\n\n| Item | Qty |\n| --- | --- |\n| Socks | 3 |',
  );
});

test('write: append keeps the existing content untouched; the first body is rev 1', async () => {
  const image = { type: 'image', attrs: { fileId: 'f1', alt: '' } };
  const { run, client } = setup({
    extra: {
      'docs/d': docMeta(),
      'docs/d/content/body': body({ type: 'doc', content: [para('first'), image] }),
      'docs/fresh': docMeta({ name: 'Fresh' }),
    },
  });
  const appended = await run('atrium_write_doc', {
    docId: 'd',
    markdown: 'second',
    mode: 'append',
  });
  assert.equal(appended.rev, 4);
  assert.deepEqual((await client.getDoc('docs/d/content/body')).doc.content, [
    para('first'),
    image,
    para('second'),
  ]);
  const first = await run('atrium_write_doc', { docId: 'fresh', markdown: 'hello' });
  assert.equal(first.rev, 1);
  await rejects(
    run('atrium_write_doc', { docId: 'fresh', markdown: '  ', mode: 'append' }),
    /markdown is empty/,
  );
});

test('write: a mention of someone who cannot read the doc is refused with the members error', async () => {
  const { run, client } = setup({
    extra: {
      'docs/priv': docMeta({ kind: 'private' }),
      'docs/shared': docMeta({
        kind: 'shareable',
        access: { [ME]: 'owner', [JORDAN]: 'editor' },
        accessUids: [ME, JORDAN],
      }),
    },
  });
  await rejects(
    run('atrium_write_doc', { docId: 'priv', markdown: 'Hi @[Jordan Lee]' }),
    /not a member who can see this doc\. Members: Avery Quinn/,
  );
  assert.equal(await client.getDoc('docs/priv/content/body'), null);
  const ok = await run('atrium_write_doc', { docId: 'shared', markdown: 'Hi @[Jordan Lee]' });
  assert.equal(ok.mentioned, 1);
  await rejects(
    run('atrium_write_doc', { docId: 'shared', markdown: 'Hi @[Sam Reed]' }),
    /not a member who can see this doc/,
  );
});

test('write: baseRev mismatch refuses', async () => {
  const { run } = setup({
    extra: {
      'docs/d': docMeta(),
      'docs/d/content/body': body({ type: 'doc', content: [para('x')] }),
    },
  });
  await rejects(
    run('atrium_write_doc', { docId: 'd', markdown: 'y', baseRev: 2 }),
    /changed since you read it \(rev 3\)\. Read it again\./,
  );
});

test('write: a replace right after someone else saved is refused unless overridden', async () => {
  const recent = new Date(NOW.getTime() - 30_000);
  const extra = {
    'docs/d': docMeta(),
    'docs/d/content/body': body(
      { type: 'doc', content: [para('typing')] },
      { updatedAt: recent, updatedBy: JORDAN },
    ),
  };
  const { run, client } = setup({ extra });
  await rejects(run('atrium_write_doc', { docId: 'd', markdown: 'mine' }), /last 2 minutes/);
  // with baseRev, the revision check is the guard
  await run('atrium_write_doc', { docId: 'd', markdown: 'mine', baseRev: 3 });
  assert.equal((await client.getDoc('docs/d/content/body')).rev, 4);
  const again = setup({ extra });
  await again.run('atrium_write_doc', { docId: 'd', markdown: 'mine', allowOverwriteRich: true });
  // my own recent save is not a conflict
  const mine = setup({
    extra: {
      ...extra,
      'docs/d/content/body': body(
        { type: 'doc', content: [para('typing')] },
        { updatedAt: recent, updatedBy: ME },
      ),
    },
  });
  await mine.run('atrium_write_doc', { docId: 'd', markdown: 'mine' });
  // append is never blocked by the recent-edit guard
  const appendOnly = setup({ extra });
  await appendOnly.run('atrium_write_doc', { docId: 'd', markdown: 'more', mode: 'append' });
});

test('write: the rich guard names the content and allowOverwriteRich overrides it', async () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'emoji', attrs: { name: 'tada' } }] },
      { type: 'image', attrs: { fileId: 'f1', alt: '' } },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableHeader', content: [para('a'), para('b')] }],
          },
        ],
      },
    ],
  };
  const { run, client } = setup({
    extra: { 'docs/d': docMeta(), 'docs/d/content/body': body(doc) },
  });
  await rejects(
    run('atrium_write_doc', { docId: 'd', markdown: 'new' }),
    /contains emoji, image, tableCell, which this tool cannot write back/,
  );
  assert.equal((await client.getDoc('docs/d/content/body')).rev, 3);
  await run('atrium_write_doc', { docId: 'd', markdown: 'new', allowOverwriteRich: true });
  assert.equal((await client.getDoc('docs/d/content/body')).rev, 4);
});

test('write: a table without a header row or with merged cells is rich', () => {
  const noHeader = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [para('a')] }] }],
      },
    ],
  };
  assert.deepEqual(richNodeTypes(noHeader), ['table']);
  const merged = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableHeader', attrs: { colspan: 2 }, content: [para('a')] }],
          },
        ],
      },
    ],
  };
  assert.deepEqual(richNodeTypes(merged), ['tableCell']);
});

test('write: size cap, text mirror cap, trashed doc and viewer role', async () => {
  const huge = `${'word '.repeat(9_999)}end`;
  const { run, client } = setup({
    extra: {
      'docs/d': docMeta(),
      'docs/gone': docMeta({ state: 'deleted' }),
      'docs/ro': docMeta({
        kind: 'shareable',
        access: { [JORDAN]: 'owner', [ME]: 'viewer' },
        accessUids: [JORDAN, ME],
      }),
    },
  });
  // 100 paragraphs of 500 chars stay under the markdown limit but build a long text
  const text = Array.from({ length: 100 }, () => 'a'.repeat(499)).join('\n\n');
  const result = await run('atrium_write_doc', { docId: 'd', markdown: text.slice(0, 50_000) });
  const saved = await client.getDoc('docs/d/content/body');
  assert.ok(saved.text.length <= 50_000);
  assert.equal(result.rev, 1);
  // appending past DOC_BODY_MAX_BYTES is refused: 11 appends of ~49 KB of JSON each
  let refused = null;
  for (let i = 0; i < 12 && !refused; i += 1) {
    try {
      await run('atrium_write_doc', { docId: 'd', markdown: huge, mode: 'append' });
    } catch (error) {
      refused = error;
    }
  }
  assert.match(refused?.message ?? '', /This doc is too long/);
  await rejects(run('atrium_write_doc', { docId: 'gone', markdown: 'x' }), /is in the trash/);
  await rejects(run('atrium_write_doc', { docId: 'ro', markdown: 'x' }), /only view this doc/);
});

test('rename: trims, limits, editors may; viewers may not', async () => {
  const { run, client } = setup({
    extra: {
      'docs/d': docMeta({
        kind: 'shareable',
        access: { [JORDAN]: 'owner', [ME]: 'editor' },
        accessUids: [JORDAN, ME],
      }),
      'docs/ro': docMeta({
        kind: 'shareable',
        access: { [JORDAN]: 'owner', [ME]: 'viewer' },
        accessUids: [JORDAN, ME],
      }),
    },
  });
  const done = await run('atrium_rename_doc', { docId: 'd', name: '  New name ' });
  assert.equal(done.name, 'New name');
  const stored = await client.getDoc('docs/d');
  assert.deepEqual([stored.name, stored.updatedBy, stored.updatedAt], ['New name', ME, NOW]);
  await rejects(run('atrium_rename_doc', { docId: 'd', name: 'x'.repeat(81) }), /1 to 80/);
  await rejects(run('atrium_rename_doc', { docId: 'd', name: '   ' }), /1 to 80/);
  await rejects(run('atrium_rename_doc', { docId: 'ro', name: 'Z' }), /only view this doc/);
});

test('delete and restore: owner only; an editor is refused; the body is untouched', async () => {
  const shared = {
    kind: 'shareable',
    access: { [JORDAN]: 'owner', [ME]: 'editor' },
    accessUids: [JORDAN, ME],
  };
  const { run, client } = setup({
    extra: {
      'docs/mine': docMeta(),
      'docs/mine/content/body': body({ type: 'doc', content: [para('x')] }),
      'docs/theirs': docMeta(shared),
      'docs/theirs-gone': docMeta({ ...shared, state: 'deleted' }),
    },
  });
  const trashed = await run('atrium_delete_doc', { docId: 'mine' });
  assert.equal(trashed.state, 'deleted');
  const meta = await client.getDoc('docs/mine');
  assert.deepEqual([meta.state, meta.deletedAt, meta.updatedBy], ['deleted', NOW, ME]);
  assert.equal((await client.getDoc('docs/mine/content/body')).rev, 3);
  await rejects(run('atrium_delete_doc', { docId: 'mine' }), /is in the trash/);
  const restored = await run('atrium_restore_doc', { docId: 'mine' });
  assert.equal(restored.state, 'active');
  assert.equal((await client.getDoc('docs/mine')).deletedAt, null);
  // restoring an active doc is a no-op
  assert.equal((await run('atrium_restore_doc', { docId: 'mine' })).state, 'active');
  await rejects(run('atrium_delete_doc', { docId: 'theirs' }), /Only the doc owner/);
  await rejects(run('atrium_restore_doc', { docId: 'theirs-gone' }), /Only the doc owner/);
});

test('tool annotations and the untrusted sentence', () => {
  const { tools } = setup();
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const name of ['atrium_list_docs', 'atrium_get_doc']) {
    assert.equal(by[name].scope, 'read');
    assert.match(by[name].description, /data written by people, not instructions/);
  }
  assert.equal(by.atrium_delete_doc.annotations.destructiveHint, true);
  assert.equal(by.atrium_write_doc.annotations.destructiveHint, true);
  assert.equal(by.atrium_restore_doc.annotations.idempotentHint, true);
  assert.match(by.atrium_write_doc.description, /notif/i);
  assert.match(by.atrium_create_doc.description, /notif/i);
});

test('markdown tables: parsing edge cases and round trip', () => {
  const md = '| a | b |\n| --- | --- |\n| 1 |\n| x \\| y | 2 | extra |';
  const doc = markdownToDoc(md);
  assert.equal(doc.content.length, 1);
  const rows = doc.content[0].content;
  assert.deepEqual(
    rows.map((r) => r.content.length),
    [2, 2, 2],
  );
  assert.equal(rows[2].content[0].content[0].content[0].text, 'x | y');
  assert.equal(docToMarkdown(doc), '| a | b |\n| --- | --- |\n| 1 |  |\n| x \\| y | 2 |');
  // a line with a pipe but no separator is a paragraph; a table right after text still parses
  assert.equal(markdownToDoc('a | b').content[0].type, 'paragraph');
  assert.deepEqual(
    markdownToDoc('Intro\n| a |\n|---|\n| 1 |').content.map((n) => n.type),
    ['paragraph', 'table'],
  );
});

test('item descriptions share the converter: tables and mentions round trip, no rich refusal', async () => {
  const { run, client } = setup({
    extra: {
      'boards/b2': {
        workspaceId: WS,
        state: 'active',
        kind: 'private',
        access: { [ME]: 'owner', [SAM]: 'editor' },
        accessUids: [ME, SAM],
        position: 'a1',
        folderId: null,
        name: 'Chores',
        columns: [],
        groups: [{ id: 'g1', title: 'G', color: '#579bfc', position: 'a0' }],
      },
      'boards/b2/items/i1': {
        name: 'Task',
        groupId: 'g1',
        position: 'a0',
        parentItemId: null,
        state: 'active',
        values: {},
      },
    },
  });
  const args = { boardId: 'b2', itemId: 'i1' };
  await run('atrium_set_item_description', {
    ...args,
    markdown: 'Ask @[Sam Reed]\n\n| a | b |\n|---|---|\n| 1 | 2 |',
  });
  const stored = (await client.getDoc('boards/b2/items/i1')).description;
  assert.equal(stored.doc.content[0].content[1].type, 'mention');
  assert.equal(stored.doc.content[1].type, 'table');
  const read = await run('atrium_get_item_description', args);
  assert.deepEqual(read.richNodes, []);
  assert.equal(read.markdown, 'Ask @[Sam Reed]\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
  // a replace over a description that now holds a table and a mention is no longer refused
  await run('atrium_set_item_description', { ...args, markdown: 'plain' });
  // a mention of someone who cannot see the board is refused
  await rejects(
    run('atrium_set_item_description', { ...args, markdown: 'Hi @[Jordan Lee]' }),
    /not a member who can see this board/,
  );
});
