import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { createTestEnv, USERS } from './helpers';

// Helper to convert Firebase compat UploadTask to a native Promise.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function put(ref: any, data: any, metadata?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    ref.put(data, metadata).then(resolve, reject);
  });
}

describe('Storage security rules (strict deny: signed URLs only)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearStorage();
  });

  it('denies unauthenticated read and write to all paths', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const storage = unauthed.storage();

    await assertFails(
      put(storage.ref('random.txt'), Buffer.from('hello'), { contentType: 'text/plain' }),
    );
    await assertFails(storage.ref('random.txt').getDownloadURL());
    await assertFails(storage.ref('random.txt').delete());
    await assertFails(
      put(storage.ref('boards/b1/items/i1/files/f1'), Buffer.from('hello'), {
        contentType: 'text/plain',
      }),
    );
    await assertFails(storage.ref('boards/b1/items/i1/files/f1').getDownloadURL());
    await assertFails(storage.ref('boards/b1/items/i1/files/f1').delete());
  });

  it('denies all direct client uploads, including for board owner and members (signed upload URLs required)', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider]) {
      const ctx = testEnv.authenticatedContext(uid);
      const storage = ctx.storage();
      const path = `boards/b1/items/i1/files/f_${uid}`;

      await assertFails(
        put(storage.ref(path), Buffer.from('content'), { contentType: 'text/plain' }),
      );
      await assertFails(put(storage.ref(path), Buffer.from('image'), { contentType: 'image/png' }));
    }
  });

  it('denies all direct client reads (signed download URLs required)', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider]) {
      const ctx = testEnv.authenticatedContext(uid);
      const storage = ctx.storage();
      const path = `boards/b1/items/i1/files/f_${uid}`;

      await assertFails(storage.ref(path).getDownloadURL());
    }
  });

  it('denies all direct client deletes and updates', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      const ctx = testEnv.authenticatedContext(uid);
      const storage = ctx.storage();
      const path = `boards/b1/items/i1/files/f_${uid}`;

      await assertFails(storage.ref(path).delete());
      await assertFails(
        put(storage.ref(path), Buffer.from('update'), { contentType: 'text/plain' }),
      );
    }
  });
});
