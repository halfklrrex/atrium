// End-to-end check of workspace membership (P4a) against the local emulators, with no browser:
// real email/password users, the real callable Functions and the real Firestore rules.
//
//   pnpm e2e:membership
//
// It builds nothing itself: run `pnpm --filter @atrium/functions build` first (the Functions
// emulator loads functions/lib). It starts the auth, firestore and functions emulators on this
// copy's ports (ATRIUM_PORT_OFFSET), runs the flow below, and shuts them down.
//
//   1. A signs up and bootstraps (personal workspace + A's member doc); B, C and D sign up.
//   2. A invites B (createInvite) and a stranger-by-email check: C (other email) and D
//      (unverified email) cannot use B's invite.
//   3. B lists the invite, opens the link status, accepts, and sees the workspace, the member
//      names and can edit an item.
//   4. A changes B to viewer: B can still read but can no longer edit.
//   5. A removes B: B loses the workspace and its boards at once, B's uid is gone from `roles`,
//      `memberIds`, the member docs and every board's `accessUids`.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { writeEmulatorConfig } from './emulator-config.mjs';
import { ports, repoRoot, portOffset } from './env.mjs';
import { firebaseCli } from './firebase-cli.mjs';
import { createFirestoreRest } from './showcase/firestore-rest.mjs';

const PROJECT = 'demo-atrium-e2e';
const REGION = 'europe-west1';

function log(message) {
  console.log(`[e2e] ${message}`);
}

export async function runFlow(p = ports()) {
  const authOrigin = `http://127.0.0.1:${p.auth}`;
  const functionsOrigin = `http://127.0.0.1:${p.functions}`;
  const firestoreOrigin = `http://127.0.0.1:${p.firestore}`;

  // ---- tiny clients -----------------------------------------------------------------------
  async function authCall(path, body, headers = {}) {
    const response = await fetch(
      `${authOrigin}/identitytoolkit.googleapis.com/v1/${path}?key=fake`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      },
    );
    const json = await response.json();
    if (!response.ok) throw new Error(`auth ${path}: ${JSON.stringify(json)}`);
    return json;
  }

  /** Creates an email/password user and returns a signed-in session (fresh token after verification). */
  async function createUser({ email, name, verified = true }) {
    const signUp = await authCall('accounts:signUp', {
      email,
      password: 'test-password-1',
      returnSecureToken: true,
    });
    // The emulator's admin token ("owner") may set the profile and mark the email verified.
    await authCall(
      'accounts:update',
      { localId: signUp.localId, displayName: name, emailVerified: verified },
      { authorization: 'Bearer owner' },
    );
    const signIn = await authCall('accounts:signInWithPassword', {
      email,
      password: 'test-password-1',
      returnSecureToken: true,
    });
    return { uid: signUp.localId, email, name, token: signIn.idToken };
  }

  async function callable(user, name, data = {}) {
    const response = await fetch(`${functionsOrigin}/${PROJECT}/${REGION}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ data }),
    });
    const json = await response.json();
    if (json.error) {
      const error = new Error(`${name}: ${json.error.status} ${json.error.message}`);
      error.status = json.error.status;
      throw error;
    }
    return json.result;
  }

  const refused = async (promise, status) => {
    await assert.rejects(promise, (e) => {
      assert.equal(e.status, status, e.message);
      return true;
    });
  };

  const admin = createFirestoreRest({
    origin: firestoreOrigin,
    project: PROJECT,
    database: FIRESTORE_DATABASE_ID,
    getToken: () => 'owner',
  });
  const asUser = (user) =>
    createFirestoreRest({
      origin: firestoreOrigin,
      project: PROJECT,
      database: FIRESTORE_DATABASE_ID,
      getToken: () => user.token,
    });

  /** True when the rules let `user` read the document; false on a permission error. */
  async function canRead(user, path) {
    try {
      await asUser(user).getDoc(path);
      return true;
    } catch (error) {
      if (/-> 403/.test(error.message)) return false;
      throw error;
    }
  }

  /**
   * True when the rules let `user` edit the item; false on a permission error. The write is the one
   * the app sends: field paths for the cell and the audit fields, with `updatedAt` set by the server.
   */
  async function canEditItem(user, boardId, itemId, note) {
    const name = `projects/${PROJECT}/databases/${FIRESTORE_DATABASE_ID}/documents/boards/${boardId}/items/${itemId}`;
    const response = await fetch(
      `${firestoreOrigin}/v1/projects/${PROJECT}/databases/${FIRESTORE_DATABASE_ID}/documents:commit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}` },
        body: JSON.stringify({
          writes: [
            {
              update: {
                name,
                fields: {
                  updatedBy: { stringValue: user.uid },
                  values: { mapValue: { fields: { note: { stringValue: note } } } },
                },
              },
              updateMask: { fieldPaths: ['updatedBy', 'values.note'] },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              currentDocument: { exists: true },
            },
          ],
        }),
      },
    );
    if (response.ok) return true;
    if (response.status === 403) return false;
    throw new Error(`item write -> ${response.status}: ${await response.text()}`);
  }

  // ---- 1. users ---------------------------------------------------------------------------
  const run = Date.now().toString(36);
  const a = await createUser({ email: `avery.${run}@example.com`, name: 'Avery Quinn' });
  const b = await createUser({ email: `jordan.${run}@example.com`, name: 'Jordan Lee' });
  const c = await createUser({ email: `casey.${run}@example.com`, name: 'Casey Morgan' });
  const d = await createUser({
    email: `sam.${run}@example.com`,
    name: 'Sam Rivera',
    verified: false,
  });
  log('1. created four users');

  const { workspaceId } = await callable(a, 'bootstrapUser');
  const aMember = await admin.getDoc(`workspaces/${workspaceId}/members/${a.uid}`);
  assert.equal(aMember.displayName, 'Avery Quinn');
  assert.equal(aMember.role, 'owner');
  assert.equal(aMember.email, a.email);
  log(`1. A bootstrapped; member doc written (workspace ${workspaceId})`);

  // Boards and an item to work with (seeded with admin rights, like the app's own writes would be).
  const now = new Date();
  const boardBase = {
    workspaceId,
    folderId: null,
    description: '',
    position: 'a0',
    icon: null,
    columns: [],
    subitemColumns: [],
    derivedColumnIds: [],
    serverManagedColumnIds: [],
    groups: [],
    itemTerminology: 'item',
    state: 'active',
    deletedAt: null,
    createdAt: now,
    createdBy: a.uid,
    updatedAt: now,
  };
  await admin.commit([
    {
      op: 'set',
      path: 'boards/e2e-main',
      data: {
        ...boardBase,
        name: 'E2E main',
        kind: 'main',
        access: { [a.uid]: 'owner' },
        accessUids: [a.uid],
      },
    },
    {
      // A private board B had been given access to earlier: the stale entry must be cleaned up.
      op: 'set',
      path: 'boards/e2e-private',
      data: {
        ...boardBase,
        name: 'E2E private',
        kind: 'private',
        access: { [a.uid]: 'owner', [b.uid]: 'editor' },
        accessUids: [a.uid, b.uid],
      },
    },
    {
      op: 'set',
      path: 'boards/e2e-main/items/i1',
      data: {
        name: 'Item',
        groupId: 'g1',
        position: 'a0',
        parentItemId: null,
        values: {},
        state: 'active',
        deletedAt: null,
        createdAt: now,
        createdBy: a.uid,
        updatedAt: now,
        updatedBy: a.uid,
      },
    },
  ]);

  // ---- 2. A invites B ---------------------------------------------------------------------
  await refused(
    callable(b, 'createInvite', { workspaceId, email: c.email, role: 'member' }),
    'PERMISSION_DENIED',
  );
  const { inviteId, inviteUrl } = await callable(a, 'createInvite', {
    workspaceId,
    email: b.email.toUpperCase(),
    role: 'member',
  });
  assert.match(inviteUrl, new RegExp(`/invite/${workspaceId}/${inviteId}$`));
  const stored = await admin.getDoc(`workspaces/${workspaceId}/invites/${inviteId}`);
  assert.equal(stored.email, b.email.toLowerCase());
  assert.equal(stored.status, 'pending');
  assert.equal(stored.invitedByName, 'Avery Quinn');
  log('2. A invited B (email stored lowercased, status pending)');

  await refused(
    callable(a, 'createInvite', { workspaceId, email: a.email, role: 'viewer' }),
    'ALREADY_EXISTS',
  );
  const refreshed = await callable(a, 'createInvite', {
    workspaceId,
    email: b.email,
    role: 'member',
  });
  assert.equal(refreshed.inviteId, inviteId, 're-inviting refreshes instead of duplicating');

  // C (other email) and D (unverified) cannot use it.
  assert.deepEqual((await callable(c, 'listMyInvites')).invites, []);
  assert.equal(
    (await callable(c, 'getInviteStatus', { workspaceId, inviteId })).state,
    'wrong_email',
  );
  await refused(callable(c, 'acceptInvite', { workspaceId, inviteId }), 'PERMISSION_DENIED');
  await refused(callable(d, 'acceptInvite', { workspaceId, inviteId }), 'PERMISSION_DENIED');
  assert.equal(await canRead(b, `workspaces/${workspaceId}`), false, 'B is not in yet');
  log('2. wrong-email and unverified accounts are refused');

  // ---- 3. B accepts -----------------------------------------------------------------------
  const mine = (await callable(b, 'listMyInvites')).invites;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].invitedByName, 'Avery Quinn');
  assert.equal(mine[0].workspaceId, workspaceId);
  assert.equal((await callable(b, 'getInviteStatus', { workspaceId, inviteId })).state, 'pending');
  const accepted = await callable(b, 'acceptInvite', { workspaceId, inviteId });
  assert.deepEqual(accepted, { workspaceId, role: 'member' });
  assert.deepEqual(
    await callable(b, 'acceptInvite', { workspaceId, inviteId }),
    accepted,
    'idempotent',
  );

  const ws = await asUser(b).getDoc(`workspaces/${workspaceId}`);
  assert.equal(ws.roles[b.uid], 'member');
  assert.deepEqual([...ws.memberIds].sort(), Object.keys(ws.roles).sort());
  const members = await asUser(b).listAllDocs(`workspaces/${workspaceId}/members`);
  const names = Object.fromEntries(members.map((m) => [m.id, m.data.displayName]));
  assert.deepEqual(names, { [a.uid]: 'Avery Quinn', [b.uid]: 'Jordan Lee' });
  assert.equal(await canRead(b, 'boards/e2e-main'), true);
  assert.equal(await canEditItem(b, 'e2e-main', 'i1', 'from B as member'), true, 'member can edit');
  assert.equal(
    await canRead(b, `workspaces/${workspaceId}/invites/${inviteId}`),
    false,
    'members cannot read invites',
  );
  assert.deepEqual((await callable(b, 'listMyInvites')).invites, []);
  log('3. B accepted (idempotent), sees the workspace and both member names, and can edit');

  // ---- 4. A makes B a viewer --------------------------------------------------------------
  await refused(
    callable(b, 'changeMemberRole', { workspaceId, uid: a.uid, role: 'viewer' }),
    'PERMISSION_DENIED',
  );
  await callable(a, 'changeMemberRole', { workspaceId, uid: b.uid, role: 'viewer' });
  assert.equal((await admin.getDoc(`workspaces/${workspaceId}/members/${b.uid}`)).role, 'viewer');
  assert.equal(await canRead(b, 'boards/e2e-main/items/i1'), true, 'viewer can read');
  assert.equal(
    await canEditItem(b, 'e2e-main', 'i1', 'from B as viewer'),
    false,
    'viewer cannot edit',
  );
  log('4. B is a viewer: reads fine, edit refused by the rules');

  // ---- 5. A removes B ---------------------------------------------------------------------
  await refused(callable(b, 'removeMember', { workspaceId, uid: a.uid }), 'PERMISSION_DENIED');
  await refused(callable(a, 'removeMember', { workspaceId, uid: a.uid }), 'FAILED_PRECONDITION');
  await callable(a, 'removeMember', { workspaceId, uid: b.uid });
  assert.equal(await canRead(b, `workspaces/${workspaceId}`), false, 'B lost the workspace');
  assert.equal(await canRead(b, 'boards/e2e-main'), false, 'B lost the main board');
  assert.equal(await canRead(b, 'boards/e2e-private'), false, 'B lost the private board');
  assert.equal(
    await canRead(b, `workspaces/${workspaceId}/members/${a.uid}`),
    false,
    'B lost the members',
  );
  const after = await admin.getDoc(`workspaces/${workspaceId}`);
  assert.ok(!(b.uid in after.roles) && !after.memberIds.includes(b.uid));
  assert.deepEqual([...after.memberIds].sort(), Object.keys(after.roles).sort());
  assert.equal(await admin.getDoc(`workspaces/${workspaceId}/members/${b.uid}`), null);
  const priv = await admin.getDoc('boards/e2e-private');
  assert.ok(!priv.accessUids.includes(b.uid), 'B is gone from accessUids');
  assert.ok(!(b.uid in priv.access), 'B is gone from access');
  assert.deepEqual(priv.accessUids, [a.uid]);
  log('5. B removed: access cut at once, uid gone from roles, memberIds, members and accessUids');

  // ---- 6. ownership transfer + leaving ----------------------------------------------------
  const second = await callable(a, 'createInvite', { workspaceId, email: b.email, role: 'admin' });
  await callable(b, 'acceptInvite', { workspaceId, inviteId: second.inviteId });
  await callable(a, 'changeMemberRole', { workspaceId, uid: b.uid, role: 'owner' });
  const transferred = await admin.getDoc(`workspaces/${workspaceId}`);
  assert.equal(transferred.ownerId, b.uid);
  assert.equal(transferred.roles[b.uid], 'owner');
  assert.equal(transferred.roles[a.uid], 'admin');
  await refused(callable(b, 'leaveWorkspace', { workspaceId }), 'FAILED_PRECONDITION');
  await callable(a, 'leaveWorkspace', { workspaceId });
  const finalWs = await admin.getDoc(`workspaces/${workspaceId}`);
  assert.deepEqual(finalWs.memberIds, [b.uid]);
  log('6. ownership transferred to B, A left; the owner cannot leave');

  log('ALL STEPS PASSED');
}

async function main() {
  if (process.argv.includes('--run')) {
    await runFlow();
    return;
  }
  const p = ports();
  const configFile = writeEmulatorConfig(p);
  console.log(
    `[e2e] ATRIUM_PORT_OFFSET=${portOffset()} auth:${p.auth} firestore:${p.firestore} functions:${p.functions}`,
  );
  const child = spawn(
    process.execPath,
    [
      firebaseCli,
      'emulators:exec',
      '--config',
      configFile,
      '--only',
      'auth,firestore,functions',
      '--project',
      PROJECT,
      `"${process.execPath}" --import tsx scripts/e2e-membership.mjs --run`,
    ],
    { stdio: 'inherit', cwd: repoRoot },
  );
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
