// P8 PR 3: `getItem` / `locateItem` (an item by id without knowing its board) and a list of
// workspaces as `actor.workspaceFilter`. In-memory Firestore only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';

const ME = 'user-me';
const OTHER = 'user-other';
const NOW = new Date('2026-11-01T10:00:00Z');

const column = (id, type, title, position, settings = {}) => ({
  id,
  type,
  title,
  position,
  settings,
});
const board = (workspaceId, more = {}) => ({
  workspaceId,
  state: 'active',
  kind: 'main',
  access: {},
  accessUids: [],
  position: 'a0',
  folderId: null,
  name: 'Board',
  description: '',
  columns: [column('price', 'text', 'Price', 'a0'), column('dup', 'text', 'Price', 'a1')],
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
  ...more,
});
const item = (more = {}) => ({
  name: 'Task',
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  state: 'active',
  values: {},
  seq: 1,
  createdAt: NOW,
  createdBy: ME,
  updatedAt: NOW,
  updatedBy: ME,
  ...more,
});
const ws = (name, roles) => ({ name, ownerId: ME, roles, memberIds: Object.keys(roles) });

function setup(actor = { uid: ME }) {
  const client = createFakeClient({
    'workspaces/w1': ws('One', { [ME]: 'owner' }),
    'workspaces/w2': ws('Two', { [ME]: 'member' }),
    'workspaces/w3': ws('Three', { [OTHER]: 'owner' }),
    'boards/b1': board('w1'),
    'boards/b2': board('w2'),
    'boards/b3': board('w3'),
    'boards/b4': board('w1', { state: 'archived' }),
    'boards/b1/items/i1': item({ name: 'Pizza', values: { price: '10' } }),
    'boards/b1/items/s1': item({ name: 'Sub', parentItemId: 'i1', values: { price: '2' } }),
    'boards/b1/items/gone': item({ name: 'Old', state: 'archived' }),
    'boards/b2/items/i2': item({ name: 'Other board' }),
    'boards/b3/items/i3': item({ name: 'Secret' }),
    'boards/b4/items/i4': item({ name: 'Archived board item' }),
  });
  return createService({ client, actor, now: () => NOW });
}

test('getItem finds the board itself and returns values by id and by title with subitems', async () => {
  const service = setup();
  const found = await service.getItem({ itemId: 'i1' });
  assert.equal(found.boardId, 'b1');
  assert.equal(found.name, 'Pizza');
  assert.deepEqual(found.group, { id: 'g1', title: 'Todo' });
  assert.equal(found.values.price, '10');
  assert.equal(found.valuesByTitle.Price, '10');
  assert.equal(found.subitems.length, 1);
  assert.equal(found.subitems[0].name, 'Sub');
  assert.equal(found.subitems[0].values.price, '2');
});

test('getItem with a boardId hint, and on a subitem', async () => {
  const service = setup();
  assert.equal((await service.getItem({ itemId: 'i2', boardId: 'b2' })).boardId, 'b2');
  const sub = await service.getItem({ itemId: 's1' });
  assert.equal(sub.parentItemId, 'i1');
  assert.equal(sub.subitems, undefined);
});

test('an item on a board the actor cannot read, an archived item and an unknown id all read as not found', async () => {
  const service = setup();
  for (const args of [
    { itemId: 'i3' },
    { itemId: 'i3', boardId: 'b3' },
    { itemId: 'gone' },
    { itemId: 'i4' },
    { itemId: 'nope' },
  ]) {
    await assert.rejects(service.getItem(args), /was not found/, JSON.stringify(args));
  }
});

test('a workspace list restricts boards, items and workspaces; an empty list shows nothing', async () => {
  const service = setup({ uid: ME, workspaceFilter: ['w1'] });
  assert.deepEqual(
    (await service.listWorkspaces()).workspaces.map((w) => w.id),
    ['w1'],
  );
  assert.equal((await service.getItem({ itemId: 'i1' })).boardId, 'b1');
  await assert.rejects(service.getItem({ itemId: 'i2' }), /was not found/);
  await assert.rejects(service.getBoard({ boardId: 'b2' }), /was not found/);

  const both = setup({ uid: ME, workspaceFilter: ['w1', 'w2'] });
  assert.equal((await both.listWorkspaces()).workspaces.length, 2);

  const none = setup({ uid: ME, workspaceFilter: [] });
  assert.equal((await none.listWorkspaces()).workspaces.length, 0);
  await assert.rejects(none.getItem({ itemId: 'i1' }), /was not found/);
});

test('a single-id workspaceFilter still works as before', async () => {
  const service = setup({ uid: ME, workspaceFilter: 'w2' });
  assert.deepEqual(
    (await service.listWorkspaces()).workspaces.map((w) => w.id),
    ['w2'],
  );
});
