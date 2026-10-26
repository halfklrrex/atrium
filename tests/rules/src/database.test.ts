// DB1: the rules suites run against the named database, and the security rules apply to it.
import { assertFails } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIRESTORE_DATABASE_ID } from '../../../packages/shared/src/firebase-env';
import { createTestEnv } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/** Reads one document over the emulator's REST API, bypassing the rules with the owner token. */
async function restStatus(databaseId: string, path: string): Promise<number> {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-atrium-rules/databases/${databaseId}/documents/${path}`,
    { headers: { authorization: 'Bearer owner' } },
  );
  return response.status;
}

describe('named database', () => {
  it('stores the test data in the named database and nowhere else', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'db1-probe'), { displayName: 'Probe' });
    });
    expect(await restStatus(FIRESTORE_DATABASE_ID, 'users/db1-probe')).toBe(200);
    expect(await restStatus('some-other-database', 'users/db1-probe')).toBe(404);
  });

  it('applies the security rules to the named database', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anon, 'users', 'db1-denied'), { displayName: 'Nope' }));
    expect(await restStatus(FIRESTORE_DATABASE_ID, 'users/db1-denied')).toBe(404);
  });
});
