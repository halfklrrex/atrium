import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { docMetaSchema } from '@atrium/shared';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as ServerOpsModule from '../../../functions/src/mcp/server-ops';
import { MAIN_BOARD, USERS, createTestEnv, seedFixture } from './helpers';

/**
 * The sharing tool through the MCP connector (batch 3 PR 2), against the Firestore emulator: the
 * hosted connector's `serverOps.setAccess` runs the sharing callables' library code in one real
 * Firestore transaction (Admin SDK), and the stored sharing fields keep the shape the rules and the
 * web read (`kind`, `access`, `accessUids`). Runs through `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let client: FirestoreClient;
let serverOpsModule: typeof ServerOpsModule;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  serverOpsModule = await import('../../../functions/src/mcp/server-ops');
  const adapter: typeof AdminClientModule = await import('../../../functions/src/mcp/admin-client');
  client = adapter.createAdminClient(admin.db());
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
});

function runAs(uid: string) {
  const firestore = admin.db();
  const serverOps = serverOpsModule.createServerOps({
    runTransaction: async () => {
      throw new Error('files are not used here');
    },
    bucket: {} as never,
    putObject: async () => undefined,
    runSharing: (fn) =>
      firestore.runTransaction((tx) =>
        fn({
          board: admin.adminBoardSharingTx(firestore, tx),
          doc: admin.adminDocSharingTx(firestore, tx),
          dashboard: admin.adminDashboardSharingTx(firestore, tx),
        }),
      ),
  });
  const tools = defineTools(createService({ client, actor: { uid }, serverOps }));
  return (name: string, args: Record<string, unknown>) =>
    tools.find((tool) => tool.name === name)!.run(args);
}

const stored = async (path: string) => (await admin.db().doc(path).get()).data();

describe('sharing written by the connector', () => {
  it('shares a doc, refuses the over-capped and the unguarded, and keeps accessUids in step', async () => {
    const run = runAs(USERS.owner);
    const created = (await run('atrium_create_doc', { name: 'Trip', kind: 'private' })) as {
      id: string;
    };

    const shared = (await run('atrium_set_access', {
      target: 'doc',
      id: created.id,
      person: { who: USERS.member, role: 'editor' },
    })) as { gained: { uid: string }[] };
    expect(shared.gained.map((g) => g.uid)).toEqual([USERS.member]);
    const doc = docMetaSchema.parse(await stored(`docs/${created.id}`));
    expect(doc.access[USERS.member]).toBe('editor');
    expect(doc.accessUids.sort()).toEqual([USERS.member, USERS.owner].sort());

    // A workspace viewer can only view; a non-member is refused.
    await expect(
      run('atrium_set_access', {
        target: 'doc',
        id: created.id,
        person: { who: USERS.viewer, role: 'editor' },
      }),
    ).rejects.toThrow(/can only view docs/);
    await expect(
      run('atrium_set_access', {
        target: 'doc',
        id: created.id,
        person: { who: USERS.outsider, role: 'viewer' },
      }),
    ).rejects.toThrow(/not a member of this workspace/);

    // Removing someone is guarded; the dry run writes nothing.
    await expect(
      run('atrium_set_access', {
        target: 'doc',
        id: created.id,
        person: { who: USERS.member, role: null },
      }),
    ).rejects.toThrow(/allowDataLoss/);
    const preview = (await run('atrium_set_access', {
      target: 'doc',
      id: created.id,
      person: { who: USERS.member, role: null },
      dryRun: true,
    })) as { lost: { uid: string }[] };
    expect(preview.lost.map((l) => l.uid)).toEqual([USERS.member]);
    expect(docMetaSchema.parse(await stored(`docs/${created.id}`)).access[USERS.member]).toBe(
      'editor',
    );
    await run('atrium_set_access', {
      target: 'doc',
      id: created.id,
      person: { who: USERS.member, role: null },
      allowDataLoss: true,
    });
    expect(docMetaSchema.parse(await stored(`docs/${created.id}`)).accessUids).toEqual([
      USERS.owner,
    ]);

    // The editor cannot change sharing (and a non-reader would see "not found").
    await expect(
      runAs(USERS.member)('atrium_set_access', { target: 'doc', id: created.id, kind: 'main' }),
    ).rejects.toThrow(/not found/);
  });

  it('makes a board private and adds a person in one transaction, with activity', async () => {
    const run = runAs(USERS.owner);
    const out = (await run('atrium_set_access', {
      target: 'board',
      id: MAIN_BOARD,
      kind: 'private',
      person: { who: USERS.member, role: 'editor' },
      allowDataLoss: true,
    })) as { lost: { uid: string }[] };
    expect(out.lost.map((l) => l.uid).sort()).toEqual([USERS.admin, USERS.viewer].sort());
    const board = await stored(`boards/${MAIN_BOARD}`);
    expect(board?.kind).toBe('private');
    expect(board?.access).toMatchObject({ [USERS.owner]: 'owner', [USERS.member]: 'editor' });
    expect((board?.accessUids as string[]).sort()).toEqual([USERS.member, USERS.owner].sort());
    const activity = await admin.db().collection(`boards/${MAIN_BOARD}/activity`).get();
    expect(activity.docs.map((d) => d.get('kind')).sort()).toEqual([
      'board_access_changed',
      'board_kind_changed',
    ]);
  });
});
