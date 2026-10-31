// Tests for the showcase seed: the data builder (schema-valid, deterministic, up to date with the
// web app's column types) and the seeding logic (idempotent, safe) against an in-memory Firestore.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FIRESTORE_DATABASE_ID,
  boardSchema,
  boardViewSchema,
  columnRegistry,
  favoriteSchema,
  itemSchema,
  itemUpdateSchema,
  notificationSchema,
  recentSchema,
  updateReplySchema,
  workspaceMemberSchema,
} from '@atrium/shared';
import {
  PENDING_TYPES,
  SHOWCASE_BOARD_IDS,
  SHOWCASE_COLUMN_TYPES,
  SHOWCASE_LINKED_ID,
  SHOWCASE_MEMBERS,
  SHOWCASE_MEMBER_UIDS,
  SHOWCASE_MAIN_ID,
  SHOWCASE_NOTIFICATION_IDS,
  anchorOf,
  buildShowcase,
  isOwnedPath,
  orderKey,
  parseCell,
} from './data.mjs';
import { createFirestoreRest, decodeFields, encodeFields } from './firestore-rest.mjs';
import {
  SeedError,
  emulatorHost,
  parseCliArgs,
  resolveOptions,
  runSeed,
} from './seed-showcase.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE = 'ws-test';
const OWNER = 'owner-uid';
const ANCHOR = anchorOf(new Date('2026-10-24T15:30:00Z'));
const DAY = 24 * 60 * 60 * 1000;

const build = (overrides = {}) =>
  buildShowcase({
    workspaceId: WORKSPACE,
    ownerUid: OWNER,
    ownerName: 'Avery',
    anchor: ANCHOR,
    ...overrides,
  });

const MAIN_ITEM = /^boards\/showcase-main\/items\/[^/]+$/;

// ---- Data builder ----------------------------------------------------------------------------

test('every document re-validates against its shared schema', () => {
  const { docs } = build();
  const byPattern = [
    [/^boards\/[^/]+$/, boardSchema],
    [/^boards\/[^/]+\/views\/[^/]+$/, boardViewSchema],
    [/^boards\/[^/]+\/items\/[^/]+$/, itemSchema],
    [/^boards\/[^/]+\/items\/[^/]+\/updates\/[^/]+$/, itemUpdateSchema],
    [/^boards\/[^/]+\/items\/[^/]+\/updates\/[^/]+\/replies\/[^/]+$/, updateReplySchema],
    [/^users\/[^/]+\/favorites\/[^/]+$/, favoriteSchema],
    [/^users\/[^/]+\/recents\/[^/]+$/, recentSchema],
    [/^users\/[^/]+\/notifications\/[^/]+$/, notificationSchema],
    [/^workspaces\/[^/]+\/members\/[^/]+$/, workspaceMemberSchema],
  ];
  for (const { path, data } of docs) {
    const entry = byPattern.find(([pattern]) => pattern.test(path));
    assert.ok(entry, `no schema for ${path}`);
    const result = entry[1].safeParse(data);
    assert.ok(result.success, `${path}: ${result.error}`);
  }
});

test('every cell value validates against the column registry', () => {
  const { docs } = build();
  const board = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  const types = new Map(board.columns.map((c) => [c.id, c.type]));
  const subTypes = new Map(board.subitemColumns.map((c) => [c.id, c.type]));
  for (const { path, data } of docs.filter((d) => MAIN_ITEM.test(d.path))) {
    for (const [columnId, value] of Object.entries(data.values)) {
      const type = (data.parentItemId ? subTypes : types).get(columnId);
      assert.ok(type, `${path}: unknown column ${columnId}`);
      assert.ok(columnRegistry.parseValue(type, value).success, `${path}.${columnId}`);
    }
  }
});

test('the seed never writes item numbers or values for the derived Item ID and Number columns', () => {
  const { docs } = build();
  const board = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  const derivedIds = board.columns
    .filter((c) => c.type === 'auto_number' || c.type === 'item_id')
    .map((c) => c.id);
  assert.equal(derivedIds.length, 2);
  for (const { path, data } of docs.filter((d) => /\/items\/[^/]+$/.test(d.path))) {
    assert.equal(data.seq, undefined, `${path} has seq`);
    assert.equal(data.boardSeq, undefined, `${path} has boardSeq`);
    for (const id of derivedIds) assert.equal(data.values[id], undefined, `${path}.${id}`);
  }
});

test('the main board has 4 coloured groups, 26 active items, and the required columns', () => {
  const { docs } = build();
  const board = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  assert.equal(board.name, '🧪 Atrium Showcase');
  assert.equal(board.kind, 'main');
  assert.deepEqual(board.accessUids, Object.keys(board.access));
  assert.equal(board.groups.length, 4);
  assert.equal(new Set(board.groups.map((g) => g.color)).size, 4);

  const items = docs.filter((d) => MAIN_ITEM.test(d.path) && d.data.parentItemId === null);
  const active = items.filter((d) => d.data.state === 'active');
  assert.equal(active.length, 26);
  assert.equal(items.filter((d) => d.data.state === 'archived').length, 2);
  assert.equal(items.filter((d) => d.data.state === 'deleted').length, 2);
  for (const group of board.groups) {
    const n = active.filter((d) => d.data.groupId === group.id).length;
    assert.ok(n >= 6 && n <= 8, `group ${group.title} has ${n} items`);
  }

  const types = board.columns.map((c) => c.type);
  assert.equal(types.filter((t) => t === 'status').length, 2);
  for (const type of [
    'people',
    'date',
    'numbers',
    'text',
    'long_text',
    'dropdown',
    'checkbox',
    'link',
  ]) {
    assert.ok(types.includes(type), `missing column type ${type}`);
  }
  const budget = board.columns.find((c) => c.id === 'budget');
  assert.deepEqual(budget.settings.unit, { symbol: '€', direction: 'left' });
});

test('positions are unique and ascending inside each group, and paths are unique', () => {
  const { docs } = build();
  const perGroup = new Map();
  for (const { data } of docs.filter((d) => MAIN_ITEM.test(d.path))) {
    // Subitems are ordered among their siblings, not in the group.
    const key = data.parentItemId ?? data.groupId;
    perGroup.set(key, [...(perGroup.get(key) ?? []), data.position]);
  }
  for (const positions of perGroup.values()) {
    assert.deepEqual(positions, [...positions].sort());
    assert.equal(new Set(positions).size, positions.length);
  }
  assert.equal(new Set(docs.map((d) => d.path)).size, docs.length);
});

test('the data is varied: statuses, overdue dates, budgets and empty cells', () => {
  const { docs } = build();
  const items = docs
    .filter((d) => MAIN_ITEM.test(d.path) && d.data.state === 'active' && !d.data.parentItemId)
    .map((d) => d.data);
  const today = new Date(ANCHOR).toISOString().slice(0, 10);
  assert.ok(new Set(items.map((i) => i.values.status?.index)).size >= 4, 'status variety');
  assert.ok(
    items.some((i) => !i.values.status),
    'some empty statuses',
  );
  const overdue = items.filter(
    (i) => i.values.due && i.values.due.date < today && i.values.status?.index !== 1,
  );
  assert.ok(overdue.length >= 2, 'at least two overdue items');
  assert.ok(
    items.some((i) => !i.values.due),
    'some items without a date',
  );
  assert.ok(items.filter((i) => i.values.budget !== undefined).length >= 20);
  assert.ok(
    items.some((i) => i.values.budget === undefined),
    'some empty budgets',
  );
  const dates = items.flatMap((i) => (i.values.due ? [i.values.due.date] : [])).sort();
  const span = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / DAY;
  assert.ok(dates[0] < today && dates.at(-1) > today && span > 40, 'dates spread around today');
});

test('timestamps are fixed, in the last 30 days, and never in the future', () => {
  const { docs } = build();
  for (const { path, data } of docs) {
    for (const key of ['createdAt', 'updatedAt', 'deletedAt', 'addedAt', 'visitedAt']) {
      const ts = data[key];
      if (!ts) continue;
      const age = (ANCHOR - ts.toMillis()) / DAY;
      assert.ok(age >= 0 && age <= 30, `${path}.${key} is ${age} days old`);
    }
    if (data.createdAt && data.updatedAt) {
      assert.ok(data.updatedAt.toMillis() >= data.createdAt.toMillis(), path);
    }
  }
});

test('subitems: 3-4 parents with 2-3 subitems each, in their parent group, default columns', () => {
  const { docs, summary } = build();
  const board = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  assert.deepEqual(
    board.subitemColumns.map((c) => c.title),
    ['Owner', 'Status', 'Date'],
  );
  const items = docs.filter((d) => MAIN_ITEM.test(d.path));
  const byId = new Map(items.map((d) => [d.path.split('/').pop(), d.data]));
  const subs = items.filter((d) => d.data.parentItemId !== null);
  assert.equal(summary.subitems, subs.length);
  const perParent = new Map();
  for (const { data } of subs) {
    const parent = byId.get(data.parentItemId);
    assert.ok(parent, `parent ${data.parentItemId} exists`);
    assert.equal(parent.parentItemId, null, 'one level only');
    assert.equal(parent.state, 'active');
    assert.equal(data.groupId, parent.groupId);
    perParent.set(data.parentItemId, (perParent.get(data.parentItemId) ?? 0) + 1);
    for (const columnId of Object.keys(data.values)) {
      assert.ok(
        board.subitemColumns.some((c) => c.id === columnId),
        columnId,
      );
    }
  }
  assert.ok(perParent.size >= 3 && perParent.size <= 4, `${perParent.size} parents`);
  for (const n of perParent.values()) assert.ok(n >= 2 && n <= 3, `${n} subitems`);
});

test('trashed items were deleted within the last few days, archived ones are archived', () => {
  const { docs } = build();
  const trashed = docs.filter((d) => d.data.state === 'deleted' && d.path.includes('/items/'));
  assert.equal(trashed.length, 2);
  for (const { data } of trashed) {
    const days = (ANCHOR - data.deletedAt.toMillis()) / DAY;
    assert.ok(days > 0 && days <= 5, `deleted ${days} days ago`);
  }
  const archived = docs.filter((d) => d.data.state === 'archived' && d.path.includes('/items/'));
  assert.equal(archived.length, 2);
  for (const { data } of archived) assert.equal(data.deletedAt, null);
  // The Archive & Trash page lists boards, so one showcase board is archived and one is deleted.
  const states = SHOWCASE_BOARD_IDS.map(
    (id) => docs.find((d) => d.path === `boards/${id}`).data.state,
  );
  assert.deepEqual(states.sort(), ['active', 'active', 'archived', 'deleted']);
});

test('updates and replies: 3-4 items, authored by the owner, counts match', () => {
  const { docs, summary } = build();
  const updates = docs.filter((d) => /\/updates\/[^/]+$/.test(d.path));
  const replies = docs.filter((d) => /\/replies\/[^/]+$/.test(d.path));
  const itemsWithUpdates = new Set(updates.map((d) => d.data.itemId));
  assert.ok(itemsWithUpdates.size >= 3 && itemsWithUpdates.size <= 4);
  assert.equal(summary.updates, updates.length);
  assert.equal(summary.replies, replies.length);
  assert.ok(replies.length >= 3);
  // The row bubble reads `updatesCount`: every showcase item carries its number of updates.
  for (const item of docs.filter((d) => /^boards\/[^/]+\/items\/[^/]+$/.test(d.path))) {
    if (item.data.parentItemId) continue;
    const own = updates.filter((u) => u.path.startsWith(`${item.path}/updates/`)).length;
    assert.equal(item.data.updatesCount, own, item.path);
  }
  for (const { data } of [...updates, ...replies]) assert.equal(data.authorId, OWNER);
  for (const { path, data } of updates) {
    const own = replies.filter((r) => r.path.startsWith(`${path}/replies/`));
    assert.equal(data.repliesCount, own.length);
  }
  for (const { path, data } of [...updates, ...replies]) {
    assert.equal(data.id, path.split('/').at(-1), 'the app also stores the id in the document');
  }
});

test('the owner has the main board as a favourite and a recent visit', () => {
  const { docs } = build();
  assert.ok(docs.some((d) => d.path === `users/${OWNER}/favorites/${SHOWCASE_MAIN_ID}`));
  assert.ok(docs.some((d) => d.path === `users/${OWNER}/recents/${SHOWCASE_MAIN_ID}`));
});

test('the owner has one notification of each kind, unread and read mixed, on real showcase content', () => {
  const { docs, summary } = build();
  const notes = docs.filter((d) => d.path.startsWith(`users/${OWNER}/notifications/`));
  assert.deepEqual(
    notes.map((d) => d.path.split('/').at(-1)),
    SHOWCASE_NOTIFICATION_IDS,
  );
  assert.equal(summary.notifications, 3);
  assert.deepEqual(notes.map((d) => d.data.kind).sort(), ['assigned', 'mention', 'reply']);
  assert.ok(notes.some((d) => d.data.readAt === null));
  assert.ok(notes.some((d) => d.data.readAt !== null));
  const paths = new Set(docs.map((d) => d.path));
  for (const { data } of notes) {
    // Nobody notifies themselves, and the thing it points at exists in the seed.
    assert.notEqual(data.actorId, OWNER);
    assert.ok(SHOWCASE_MEMBER_UIDS.includes(data.actorId));
    assert.ok(paths.has(`boards/${data.boardId}/items/${data.itemId}`));
    if (data.updateId) {
      assert.ok(paths.has(`boards/${data.boardId}/items/${data.itemId}/updates/${data.updateId}`));
    }
    if (data.replyId) {
      assert.ok(
        paths.has(
          `boards/${data.boardId}/items/${data.itemId}/updates/${data.updateId}/replies/${data.replyId}`,
        ),
      );
    }
  }
});

test('building twice gives identical documents', () => {
  const serialise = (r) => JSON.stringify(r.docs.map((d) => [d.path, encodeFields(d.data)]));
  assert.equal(serialise(build()), serialise(build()));
});

test('invalid data fails loudly', () => {
  const columns = new Map([
    ['due', { id: 'due', type: 'date', title: 'Due date' }],
    ['budget', { id: 'budget', type: 'numbers', title: 'Budget' }],
  ]);
  assert.throws(
    () => parseCell(columns, 'due', { date: '2026-13-45' }, 'Bad item'),
    /Bad item.*Due date/,
  );
  assert.throws(() => parseCell(columns, 'budget', 'lots', 'Bad item'), /Budget/);
  assert.throws(() => parseCell(columns, 'nope', 'x', 'Bad item'), /unknown column/);
  assert.throws(() => buildShowcase({ ownerUid: OWNER }), /workspaceId/);
});

test('every column type with a web UI is in the showcase; the rest are declared pending', () => {
  const source = readFileSync(resolve(repoRoot, 'apps/web/src/columns/registry.ts'), 'utf8');
  const order = /ADD_COLUMN_ORDER\s*=\s*\[([^\]]*)\]/.exec(source);
  assert.ok(order, 'could not find ADD_COLUMN_ORDER in apps/web/src/columns/registry.ts');
  const webTypes = [...order[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(webTypes.length >= 9);

  for (const type of webTypes) {
    assert.ok(
      SHOWCASE_COLUMN_TYPES.includes(type),
      `The web app can render "${type}" but the showcase board has no such column. Add it to scripts/showcase/data.mjs (AGENTS.md rule).`,
    );
  }
  for (const type of PENDING_TYPES) {
    assert.ok(
      !webTypes.includes(type),
      `"${type}" now has a web UI: move it out of PENDING_TYPES into COLUMNS in data.mjs.`,
    );
    assert.ok(!SHOWCASE_COLUMN_TYPES.includes(type));
  }
  for (const { type } of columnRegistry.list()) {
    assert.ok(
      SHOWCASE_COLUMN_TYPES.includes(type) || PENDING_TYPES.includes(type),
      `Column type "${type}" is registered in @atrium/shared but neither shown nor listed in PENDING_TYPES.`,
    );
  }
});

test('the Mirror columns read a linked demo board that exists and holds the linked items', () => {
  const { docs } = build();
  const main = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  const linked = docs.find((d) => d.path === `boards/${SHOWCASE_LINKED_ID}`);
  assert.ok(linked, 'the linked demo board is seeded');
  assert.equal(linked.data.state, 'active');
  const linkedColumnIds = new Set(linked.data.columns.map((c) => c.id));
  const relation = main.columns.find((c) => c.type === 'board_relation');
  assert.deepEqual(relation.settings.boardIds, [SHOWCASE_LINKED_ID]);

  const mirrors = main.columns.filter((c) => c.type === 'mirror');
  assert.deepEqual(
    mirrors.map((c) => [c.title, c.settings.aggregation]),
    [
      ['Linked status', 'none'],
      ['Total budget', 'sum'],
    ],
  );
  for (const mirror of mirrors) {
    assert.equal(mirror.settings.relationColumnId, relation.id);
    assert.ok(linkedColumnIds.has(mirror.settings.targetColumnIds[SHOWCASE_LINKED_ID]));
  }

  const linkedItemIds = new Set(
    docs
      .filter((d) => d.path.startsWith(`boards/${SHOWCASE_LINKED_ID}/items/`))
      .map((d) => d.path.split('/').pop()),
  );
  assert.ok(linkedItemIds.size >= 4);
  const links = docs
    .filter((d) => MAIN_ITEM.test(d.path))
    .flatMap((d) => d.data.values[relation.id]?.linkedItems ?? []);
  assert.ok(links.length >= 6, 'several main items link to the demo board');
  for (const ref of links) {
    assert.equal(ref.boardId, SHOWCASE_LINKED_ID);
    assert.ok(linkedItemIds.has(ref.itemId), ref.itemId);
  }
  // Mirrors store nothing.
  for (const { path, data } of docs.filter((d) => MAIN_ITEM.test(d.path))) {
    for (const mirror of mirrors) assert.equal(data.values[mirror.id], undefined, path);
  }
});

test('orderKey yields ascending keys', () => {
  const keys = Array.from({ length: 62 }, (_, i) => orderKey(i));
  assert.deepEqual(keys, [...keys].sort());
  assert.throws(() => orderKey(62));
});

test('the fake members get profile docs only, never roles or memberIds', async () => {
  const { docs } = build();
  const members = docs.filter((d) => d.path.includes('/members/'));
  assert.deepEqual(
    members.map((d) => d.path).sort(),
    SHOWCASE_MEMBER_UIDS.map((uid) => `workspaces/${WORKSPACE}/members/${uid}`).sort(),
  );
  for (const { data } of members) assert.match(data.email, /@example.com$/);
  assert.equal(SHOWCASE_MEMBERS.length, 3);
  // Nothing in the seed touches the workspace document itself.
  assert.ok(!docs.some((d) => d.path === `workspaces/${WORKSPACE}`));

  const client = fakeFirestore(baseWorld());
  await seed(client);
  const workspace = client.store.get(`workspaces/${WORKSPACE}`);
  for (const uid of SHOWCASE_MEMBER_UIDS) {
    assert.ok(client.store.has(`workspaces/${WORKSPACE}/members/${uid}`));
    assert.ok(!workspace.memberIds.includes(uid));
    assert.ok(!(uid in workspace.roles));
  }
});

test('People cells reference the fake members', () => {
  const { docs } = build();
  const used = new Set(
    docs
      .filter((d) => MAIN_ITEM.test(d.path))
      .flatMap((d) => d.data.values.person?.personsAndTeams ?? [])
      .map((p) => p.id),
  );
  for (const uid of SHOWCASE_MEMBER_UIDS) assert.ok(used.has(uid), uid);
});

test('ownership allow-list', () => {
  assert.ok(
    isOwnedPath(`workspaces/${WORKSPACE}/members/${SHOWCASE_MEMBER_UIDS[0]}`, OWNER, WORKSPACE),
  );
  // Member docs are only ours inside the workspace being seeded, and only for the fake uids.
  assert.ok(!isOwnedPath(`workspaces/${WORKSPACE}/members/${SHOWCASE_MEMBER_UIDS[0]}`, OWNER));
  assert.ok(!isOwnedPath(`workspaces/other/members/${SHOWCASE_MEMBER_UIDS[0]}`, OWNER, WORKSPACE));
  assert.ok(!isOwnedPath(`workspaces/${WORKSPACE}/members/${OWNER}`, OWNER, WORKSPACE));
  assert.ok(!isOwnedPath(`workspaces/${WORKSPACE}/members/real-user`, OWNER, WORKSPACE));
  assert.ok(!isOwnedPath(`workspaces/${WORKSPACE}`, OWNER, WORKSPACE));
  assert.ok(!isOwnedPath(`workspaces/${WORKSPACE}/invites/showcase-user-sam`, OWNER, WORKSPACE));
  assert.ok(isOwnedPath('boards/showcase-main', OWNER));
  assert.ok(isOwnedPath('boards/showcase-main/items/x/updates/y/replies/z', OWNER));
  assert.ok(isOwnedPath(`users/${OWNER}/favorites/showcase-main`, OWNER));
  assert.ok(isOwnedPath(`users/${OWNER}/recents/showcase-trashed-demo`, OWNER));
  assert.ok(!isOwnedPath('boards/real-board', OWNER));
  assert.ok(!isOwnedPath('boards/showcase-other', OWNER));
  assert.ok(!isOwnedPath('boards', OWNER));
  assert.ok(!isOwnedPath(`users/${OWNER}`, OWNER));
  assert.ok(!isOwnedPath(`users/${OWNER}/favorites/real-board`, OWNER));
  assert.ok(!isOwnedPath('users/someone-else/favorites/showcase-main', OWNER));
  assert.ok(!isOwnedPath(`users/${OWNER}/notifications/showcase-main`, OWNER));
  assert.ok(isOwnedPath(`users/${OWNER}/notifications/${SHOWCASE_NOTIFICATION_IDS[0]}`, OWNER));
  assert.ok(!isOwnedPath(`users/${OWNER}/notifications/real-notification`, OWNER));
  assert.ok(
    !isOwnedPath(`users/someone-else/notifications/${SHOWCASE_NOTIFICATION_IDS[0]}`, OWNER),
  );
  assert.ok(!isOwnedPath('workspaces/ws-test', OWNER));
  assert.ok(!isOwnedPath('boards/showcase-main/../real-board', OWNER));
});

// ---- REST encoding ---------------------------------------------------------------------------

test('REST encoding round-trips every document, timestamps included', () => {
  const { docs } = build();
  const normalise = (value) =>
    JSON.parse(
      JSON.stringify(value, function (key, v) {
        const raw = this[key]; // before Date#toJSON turns it into a string
        if (raw && typeof raw.toMillis === 'function') return raw.toMillis();
        if (raw instanceof Date) return raw.getTime();
        return v;
      }),
    );
  for (const { path, data } of docs) {
    assert.deepEqual(normalise(decodeFields(encodeFields(data))), normalise(data), path);
  }
  assert.deepEqual(encodeFields({ a: 1, b: 1.5, c: undefined, d: [], e: null }), {
    a: { integerValue: '1' },
    b: { doubleValue: 1.5 },
    d: { arrayValue: { values: [] } },
    e: { nullValue: null },
  });
  assert.throws(() => encodeFields({ n: Number.NaN }));
});

test('the REST client sends the token, the quota project and well-formed commits', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const client = createFirestoreRest({
    origin: 'https://firestore.googleapis.com',
    project: 'atrium-board',
    quotaProject: 'atrium-board',
    getToken: () => 'secret-token',
    fetch: fakeFetch,
  });
  await client.commit([
    { op: 'set', path: 'boards/showcase-main', data: { name: 'x', n: 2 } },
    { op: 'delete', path: 'boards/showcase-main/items/a' },
  ]);
  const [call] = calls;
  assert.equal(
    call.url,
    `https://firestore.googleapis.com/v1/projects/atrium-board/databases/${FIRESTORE_DATABASE_ID}/documents:commit`,
  );
  assert.equal(call.init.headers.authorization, 'Bearer secret-token');
  assert.equal(call.init.headers['x-goog-user-project'], 'atrium-board');
  const root = `projects/atrium-board/databases/${FIRESTORE_DATABASE_ID}/documents`;
  assert.deepEqual(call.body.writes, [
    {
      update: {
        name: `${root}/boards/showcase-main`,
        fields: { name: { stringValue: 'x' }, n: { integerValue: '2' } },
      },
    },
    { delete: `${root}/boards/showcase-main/items/a` },
  ]);
  await client.commit([]); // nothing to do, no request
  assert.equal(calls.length, 1);
});

// ---- Seeding against an in-memory Firestore --------------------------------------------------

/** Just enough of the REST client's surface, backed by a Map of path -> data. */
function fakeFirestore(initial = {}) {
  const store = new Map(Object.entries(initial));
  const commits = [];
  const childrenOf = (prefix) => {
    const ids = new Set();
    for (const path of store.keys()) {
      if (path.startsWith(`${prefix}/`)) ids.add(path.slice(prefix.length + 1).split('/')[0]);
    }
    return [...ids];
  };
  return {
    store,
    commits,
    describe: 'fake firestore',
    async getDoc(path) {
      return store.has(path) ? structuredClone(store.get(path)) : null;
    },
    async listDocIds(collectionPath) {
      return childrenOf(collectionPath);
    },
    async listDocs(collectionPath) {
      return childrenOf(collectionPath).flatMap((id) =>
        store.has(`${collectionPath}/${id}`)
          ? [{ id, data: store.get(`${collectionPath}/${id}`) }]
          : [],
      );
    },
    async listCollectionIds(docPath) {
      return childrenOf(docPath);
    },
    async commit(writes) {
      assert.ok(writes.length <= 500, 'a commit may hold at most 500 writes');
      commits.push(writes);
      for (const w of writes) {
        if (w.op === 'delete') store.delete(w.path);
        else store.set(w.path, structuredClone(w.data));
      }
    },
  };
}

const baseWorld = () => ({
  [`workspaces/${WORKSPACE}`]: {
    name: 'Test Workspace',
    ownerId: OWNER,
    memberIds: [OWNER, 'viewer-uid'],
    roles: { [OWNER]: 'owner', 'viewer-uid': 'viewer' },
  },
  [`users/${OWNER}`]: { displayName: 'Avery Quinn', photoURL: null },
  // Things the seed must never touch:
  'boards/real-board': { workspaceId: WORKSPACE, name: 'My real board' },
  'boards/real-board/items/i1': { name: 'Real item', groupId: 'g1' },
  'boards/real-board/items/i1/updates/u1': { content: 'Real update' },
  [`users/${OWNER}/favorites/real-board`]: { boardId: 'real-board' },
  [`users/${OWNER}/recents/real-board`]: { boardId: 'real-board' },
  [`users/${OWNER}/notifications/n1`]: { text: 'hello' },
  'workspaces/other': { name: 'Other', memberIds: ['x'], roles: { x: 'owner' } },
  'boards/other-board': { workspaceId: 'other', name: 'Other board' },
});

const quiet = () => {};
const seed = (client, extra = {}) =>
  runSeed({
    client,
    workspaceId: WORKSPACE,
    ownerUid: OWNER,
    anchor: ANCHOR,
    log: quiet,
    ...extra,
  });
const snapshot = (client) =>
  JSON.stringify([...client.store.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
const isShowcasePath = (p) =>
  /^boards\/showcase-/.test(p) ||
  /\/(favorites|recents)\/showcase-/.test(p) ||
  /\/notifications\/showcase-notification-/.test(p) ||
  /^workspaces\/[^/]+\/members\/showcase-user-/.test(p);
const foreignDocs = (client) =>
  Object.fromEntries([...client.store.entries()].filter(([p]) => !isShowcasePath(p)));

test('refuses when the workspace is missing, the owner is not a member, or is only a viewer', async () => {
  const client = fakeFirestore(baseWorld());
  await assert.rejects(seed(client, { workspaceId: 'nope' }), /does not exist/);
  await assert.rejects(seed(client, { ownerUid: 'stranger' }), /not a member/);
  await assert.rejects(seed(client, { ownerUid: 'viewer-uid' }), /only a viewer/);
  assert.equal(client.commits.length, 0);
});

test('refuses to take over a showcase board that lives in another workspace', async () => {
  const client = fakeFirestore({
    ...baseWorld(),
    'boards/showcase-main': { workspaceId: 'other' },
  });
  await assert.rejects(seed(client), /another workspace/);
  assert.equal(client.commits.length, 0);
});

test('a dry run writes nothing', async () => {
  const client = fakeFirestore(baseWorld());
  const before = snapshot(client);
  const plan = await seed(client, { dryRun: true });
  assert.equal(snapshot(client), before);
  assert.equal(client.commits.length, 0);
  assert.ok(plan.writeCount > 40);
});

test('seeding creates the showcase and leaves everything else alone', async () => {
  const client = fakeFirestore(baseWorld());
  const before = structuredClone(foreignDocs(client));
  const plan = await seed(client);
  assert.equal(plan.deleteCount, 0);
  assert.ok(client.store.has(`boards/${SHOWCASE_MAIN_ID}`));
  assert.ok(client.store.has(`users/${OWNER}/favorites/${SHOWCASE_MAIN_ID}`));
  assert.deepEqual(foreignDocs(client), before);
  // The author name comes from the owner's profile.
  const [, update] = [...client.store.entries()].find(([p]) =>
    /^boards\/showcase-.*\/updates\/[^/]+$/.test(p),
  );
  assert.equal(update.authorName, 'Avery Quinn');
  for (const commit of client.commits) {
    for (const w of commit) assert.ok(isOwnedPath(w.path, OWNER, WORKSPACE), w.path);
  }
});

test('re-running converges to the same state and prunes showcase docs that are no longer wanted', async () => {
  const client = fakeFirestore(baseWorld());
  await seed(client);
  const first = snapshot(client);

  // Someone edited an item by hand, and stale docs linger from an older version of the content.
  client.store.get('boards/showcase-main/items/showcase-hero-copy').name = 'Edited by hand';
  client.store.set('boards/showcase-main/items/showcase-removed-item', { name: 'old' });
  client.store.set('boards/showcase-main/items/showcase-removed-item/updates/u', { content: 'x' });
  client.store.set('boards/showcase-main/items/showcase-hero-copy/updates/old-update', {});
  client.store.set(
    'boards/showcase-main/items/showcase-hero-copy/updates/showcase-hero-copy-u2/replies/old',
    {},
  );

  const plan = await seed(client);
  assert.equal(plan.deleteCount, 4);
  assert.equal(snapshot(client), first);

  const again = await seed(client);
  assert.equal(again.deleteCount, 0);
  assert.equal(snapshot(client), first);
});

test('re-running keeps the item numbers the function assigned', async () => {
  const client = fakeFirestore(baseWorld());
  await seed(client);
  const path = 'boards/showcase-main/items/showcase-hero-copy';
  Object.assign(client.store.get(path), { seq: 17, boardSeq: 4 });
  await seed(client);
  assert.equal(client.store.get(path).seq, 17);
  assert.equal(client.store.get(path).boardSeq, 4);
  // A reset recreates the items, so the function numbers them afresh.
  await seed(client, { reset: true });
  assert.equal(client.store.get(path).seq, undefined);
});

test('the main board has a shared "Due this week" view: date filter, date sort, two hidden columns', () => {
  const { docs, summary } = build();
  const views = docs.filter((d) => /^boards\/showcase-main\/views\/[^/]+$/.test(d.path));
  assert.equal(summary.views, 3);
  assert.equal(views.length, 3);
  const view = views.find((v) => v.data.name === 'Due this week').data;
  assert.equal(view.name, 'Due this week');
  assert.equal(view.type, 'table');
  assert.equal(view.ownerId, null);
  const board = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  const columnIds = new Set(board.columns.map((c) => c.id));
  assert.equal(view.settings.hiddenColumnIds.length, 2);
  for (const id of view.settings.hiddenColumnIds) assert.ok(columnIds.has(id), id);
  assert.deepEqual(view.settings.filter.sortConditions, [{ columnId: 'due', direction: 'asc' }]);
  const [from, to] = view.settings.filter.filterGroup.conditions;
  assert.equal(from.columnId, 'due');
  assert.equal(from.value, '2026-10-23');
  assert.equal(to.value, '2026-10-31');
});

test('the main board has a shared Kanban "Status board": lanes from Status, three card fields', () => {
  const { docs } = build();
  const view = docs.find((d) => d.path === 'boards/showcase-main/views/showcase-status-board').data;
  assert.equal(view.type, 'kanban');
  assert.equal(view.ownerId, null);
  const board = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  const status = board.columns.find((c) => c.id === view.settings.kanban.columnId);
  assert.equal(status.type, 'status');
  assert.equal(view.settings.kanban.cardColumnIds.length, 3);
  for (const id of view.settings.kanban.cardColumnIds) {
    assert.ok(
      board.columns.some((c) => c.id === id),
      id,
    );
  }
});

test('the main board has a shared Calendar "Due dates": placed by the Due date column, coloured by Status', () => {
  const { docs } = build();
  const view = docs.find((d) => d.path === 'boards/showcase-main/views/showcase-due-calendar').data;
  assert.equal(view.type, 'calendar');
  assert.equal(view.ownerId, null);
  const board = docs.find((d) => d.path === `boards/${SHOWCASE_MAIN_ID}`).data;
  const column = board.columns.find((c) => c.id === view.settings.calendar.columnId);
  assert.equal(column.type, 'date');
  const color = board.columns.find((c) => c.id === view.settings.calendar.colorBy);
  assert.equal(color.type, 'status');
  // Enough dated items to fill the month on screen.
  const items = docs.filter(
    (d) => /^boards\/showcase-main\/items\/[^/]+$/.test(d.path) && d.data.values?.[column.id],
  );
  assert.ok(items.length >= 15, `${items.length} dated items`);
});

test('a view that left the content is pruned on the next run', async () => {
  const client = fakeFirestore(baseWorld());
  await seed(client);
  client.store.set('boards/showcase-main/views/showcase-old-view', { name: 'Old' });
  const plan = await seed(client);
  assert.equal(plan.deleteCount, 1);
  assert.ok(!client.store.has('boards/showcase-main/views/showcase-old-view'));
  assert.ok(client.store.has('boards/showcase-main/views/showcase-due-this-week'));
});

test('--reset deletes the showcase boards recursively, even unknown sub-collections, then recreates them', async () => {
  const client = fakeFirestore(baseWorld());
  await seed(client);
  const first = snapshot(client);
  client.store.set('boards/showcase-main/activity/a1', { what: 'something' });
  client.store.set('boards/showcase-main/views/v1', { name: 'A view' });
  client.store.set('boards/showcase-main/items/showcase-removed-item', { name: 'old' });
  const before = structuredClone(foreignDocs(client));
  client.commits.length = 0;

  const plan = await seed(client, { reset: true });
  assert.ok(plan.deleteCount > 40);
  assert.ok(!client.store.has('boards/showcase-main/activity/a1'));
  assert.ok(!client.store.has('boards/showcase-main/views/v1'));
  assert.equal(snapshot(client), first);
  assert.deepEqual(foreignDocs(client), before);

  // Every deletion is committed before the first write.
  const kinds = client.commits.map((c) => (c.every((w) => w.op === 'delete') ? 'd' : 's'));
  assert.equal(kinds.join('').replace(/d+s+/, ''), '', kinds.join('')); // all d first, then all s
  assert.ok(kinds.includes('d') && kinds.includes('s'));
});

// ---- CLI -------------------------------------------------------------------------------------

test('argument handling', () => {
  const opts = (args) => resolveOptions(parseCliArgs(args));
  assert.equal(opts([]).target, 'emulator');
  assert.equal(opts([]).database, FIRESTORE_DATABASE_ID);
  assert.equal(opts(['--database', 'other-db']).database, 'other-db');
  assert.throws(() => opts(['--database', 'No Good']), /database id/);
  assert.equal(opts(['--emulator']).dryRun, false);
  assert.throws(() => opts(['--emulator', '--project', 'atrium-board']), SeedError);
  assert.throws(() => opts(['--project', 'atrium-board']), /both/);
  assert.throws(
    () => opts(['--project', 'atrium-board', '--workspace', 'a/b', '--owner', 'u']),
    /plain id/,
  );
  assert.throws(() => opts(['--workspace', '../x']), /plain id/);
  assert.throws(() => opts(['--now', 'yesterday']), /--now/);

  const dry = opts(['--project', 'atrium-board', '--workspace', 'w', '--owner', 'u']);
  assert.equal(dry.target, 'production');
  assert.equal(dry.dryRun, true, 'production without --yes is a dry run');
  assert.equal(dry.quotaProject, 'atrium-board');
  const live = opts([
    '--project',
    'atrium-board',
    '--workspace',
    'w',
    '--owner',
    'u',
    '--yes',
    '--reset',
  ]);
  assert.equal(live.dryRun, false);
  assert.equal(live.reset, true);
  assert.equal(opts(['--now', '2026-10-24']).anchor, Date.UTC(2026, 9, 24));
});

test('the emulator host must be local', () => {
  assert.equal(emulatorHost({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8130' }), '127.0.0.1:8130');
  assert.equal(emulatorHost({ FIRESTORE_EMULATOR_HOST: 'localhost:8080' }), 'localhost:8080');
  assert.throws(
    () => emulatorHost({ FIRESTORE_EMULATOR_HOST: 'firestore.example.com:443' }),
    /not a local address/,
  );
});
