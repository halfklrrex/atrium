import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { docBodySchema, docMetaSchema } from '@atrium/shared';
import { createService, defineTools, type FirestoreClient } from '@atrium/mcp-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import { USERS, WS, createTestEnv, seedFixture } from './helpers';

/**
 * Docs through the MCP connector (batch 2 PR 2), against the Firestore emulator: the hosted connector's
 * Admin SDK client creates a doc with a body, writes it again (rev 2, through an `updateTime`
 * precondition) and the stored documents read back in the web's shape (`docMetaSchema`,
 * `docBodySchema`). Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let client: FirestoreClient;

/** The stored document as the web reads it: Firestore timestamps, not the client's Dates. */
const stored = async (path: string) => (await admin.db().doc(path).get()).data();

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  const adapter: typeof AdminClientModule = await import('../../../functions/src/mcp/admin-client');
  client = adapter.createAdminClient(admin.db());
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    const db = ctx.firestore();
    for (const [uid, name] of [
      [USERS.owner, 'Olive Owner'],
      [USERS.member, 'Avery Quinn'],
    ] as const) {
      await setDoc(doc(db, 'workspaces', WS, 'members', uid), {
        displayName: name,
        email: `${uid}@example.com`,
        photoURL: null,
        role: uid,
      });
    }
  });
});

describe('docs written by the connector', () => {
  it('creates a doc with a body, bumps rev on the next write, and reads back in the web shape', async () => {
    const service = createService({ client, actor: { uid: USERS.owner } });
    const tools = defineTools(service);
    const run = (name: string, args: Record<string, unknown>) =>
      tools.find((tool) => tool.name === name)!.run(args);

    const created = (await run('atrium_create_doc', {
      name: 'Packing list',
      markdown: 'Bring: @[Avery Quinn]\n\n| Item | Qty |\n| --- | --- |\n| Socks | 3 |',
    })) as { id: string; rev: number; mentioned: number };
    expect(created.rev).toBe(1);
    expect(created.mentioned).toBe(1);

    const meta = docMetaSchema.parse(await stored(`docs/${created.id}`));
    expect(meta).toMatchObject({
      name: 'Packing list',
      kind: 'main',
      access: { [USERS.owner]: 'owner' },
      accessUids: [USERS.owner],
      state: 'active',
      folderId: null,
    });
    const first = docBodySchema.parse(await stored(`docs/${created.id}/content/body`));
    expect(first.rev).toBe(1);
    expect(first.updatedBy).toBe(USERS.owner);

    const second = (await run('atrium_write_doc', {
      docId: created.id,
      markdown: 'More socks',
      mode: 'append',
      baseRev: 1,
    })) as { rev: number };
    expect(second.rev).toBe(2);
    const after = docBodySchema.parse(await stored(`docs/${created.id}/content/body`));
    expect(after.rev).toBe(2);
    expect(after.text).toContain('More socks');
    expect(after.text).toContain('@Avery Quinn');

    // A stale baseRev is refused and nothing changes.
    await expect(
      run('atrium_write_doc', { docId: created.id, markdown: 'late', baseRev: 1 }),
    ).rejects.toThrow(/changed since you read it \(rev 2\)/);

    // The doc lists, reads, renames, trashes and restores.
    const listed = (await run('atrium_list_docs', {})) as { docs: { id: string }[] };
    expect(listed.docs.map((d) => d.id)).toEqual([created.id]);
    const read = (await run('atrium_get_doc', { docId: created.id })) as {
      rev: number;
      markdown: string;
      richNodes: string[];
    };
    expect(read.rev).toBe(2);
    expect(read.markdown).toContain('| Socks | 3 |');
    expect(read.richNodes).toEqual([]);
    await run('atrium_rename_doc', { docId: created.id, name: 'Trip list' });
    await run('atrium_delete_doc', { docId: created.id });
    const trash = (await run('atrium_list_docs', { state: 'deleted' })) as {
      docs: { name: string }[];
    };
    expect(trash.docs.map((d) => d.name)).toEqual(['Trip list']);
    await run('atrium_restore_doc', { docId: created.id });
    expect(docMetaSchema.parse(await stored(`docs/${created.id}`)).state).toBe('active');
  });
});
