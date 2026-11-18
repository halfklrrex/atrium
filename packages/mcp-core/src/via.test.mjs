// P8 PR 7a: `actor.via` (incoming webhooks): stamped as `updatedVia` on created items, refuses locked
// columns even for an owner, and only accepts the `webhook:<id>` shape. In-memory Firestore only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';

const ME = 'user-me';
const seed = () => ({
  'workspaces/w1': { name: 'Home', ownerId: ME, roles: { [ME]: 'owner' }, memberIds: [ME] },
  'users/user-me': { displayName: 'Avery Quinn' },
  'boards/b1': {
    workspaceId: 'w1',
    state: 'active',
    kind: 'main',
    access: {},
    accessUids: [],
    position: 'a0',
    folderId: null,
    name: 'Board',
    description: '',
    columns: [
      { id: 'note', type: 'text', title: 'Note', position: 'a0', settings: {} },
      { id: 'lock', type: 'text', title: 'Locked', position: 'a1', settings: {} },
    ],
    subitemColumns: [],
    columnLocks: ['lock'],
    groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
  },
});

test('via is stamped as updatedVia on created items, and absent otherwise', async () => {
  const client = createFakeClient(seed());
  const hook = createService({ client, actor: { uid: ME, via: 'webhook:abc123' } });
  const { created } = await hook.createItems({ boardId: 'b1', items: [{ name: 'From hook' }] });
  assert.equal(
    client.docs.get(`boards/b1/items/${created[0].id}`).data.updatedVia,
    'webhook:abc123',
  );
  const person = createService({ client, actor: { uid: ME } });
  const own = await person.createItems({ boardId: 'b1', items: [{ name: 'By hand' }] });
  assert.equal('updatedVia' in client.docs.get(`boards/b1/items/${own.created[0].id}`).data, false);
});

test('a locked column is refused for a webhook even when the creator owns the board', async () => {
  const client = createFakeClient(seed());
  const hook = createService({ client, actor: { uid: ME, via: 'webhook:abc123' } });
  await assert.rejects(
    hook.createItems({ boardId: 'b1', items: [{ name: 'X', values: { Locked: 'x' } }] }),
    /locked/,
  );
  const person = createService({ client, actor: { uid: ME } });
  await person.createItems({ boardId: 'b1', items: [{ name: 'X', values: { Locked: 'x' } }] });
});

test('via must look like webhook:<id>', () => {
  const client = createFakeClient(seed());
  for (const via of ['form', 'automation:x', 'webhook:', 'webhook:a b', 42]) {
    assert.throws(() => createService({ client, actor: { uid: ME, via } }), /actor\.via/);
  }
});
