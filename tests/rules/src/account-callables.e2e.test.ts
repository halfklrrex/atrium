import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USERS, WS, createTestEnv, seedFixture } from './helpers';

/**
 * End to end against the Firestore emulator (ADMIN-4 PR3): the real callables (`createInvite`,
 * `acceptInvite`, `submitForm`, `clickButton`, `bootstrapUser`), with the real Admin SDK adapters,
 * are run with ID tokens that carry each account state. A pending, blocked or claim-less token is
 * refused with `permission-denied` / `account-not-approved` before any data is touched; an approved
 * token passes the gate. The Functions emulator is not needed: `onCall` handlers expose `.run`.
 * Runs through `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
const priorApprovalFlag = process.env.ACCOUNT_APPROVAL_REQUIRED;
type Callable = { run: (request: CallableRequest<unknown>) => Promise<unknown> };
let callables: Record<'createInvite' | 'acceptInvite' | 'submitForm' | 'clickButton', Callable>;
let bootstrapUser: Callable;

const tokenOf = (claims: Record<string, unknown>) => ({
  email: 'owner@example.com',
  email_verified: true,
  name: 'Avery Quinn',
  ...claims,
});

function request(uid: string, claims: Record<string, unknown>, data: unknown): CallableRequest {
  return {
    data,
    auth: { uid, token: tokenOf(claims) },
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as CallableRequest;
}

async function failure(promise: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; details: unknown };
  }
  throw new Error('expected the callable to refuse');
}

const inviteData = { workspaceId: WS, email: 'new.person@example.com', role: 'member' };
const calls: Array<[keyof typeof callables, unknown]> = [
  ['createInvite', inviteData],
  ['acceptInvite', { inviteId: 'invite1' }],
  ['submitForm', { boardId: 'boardMain', viewId: 'formView', answers: { name: 'Hello' } }],
  ['clickButton', { boardId: 'boardMain', itemId: 'i1', columnId: 'btn' }],
];

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  // With approval off, bootstrapUser reports no status at all; production has it on.
  process.env.ACCOUNT_APPROVAL_REQUIRED = 'true';
  env = await createTestEnv();
  callables = {
    createInvite: (await import('../../../functions/src/callable/createInvite'))
      .createInvite as unknown as Callable,
    acceptInvite: (await import('../../../functions/src/callable/acceptInvite'))
      .acceptInvite as unknown as Callable,
    submitForm: (await import('../../../functions/src/callable/submitForm'))
      .submitForm as unknown as Callable,
    clickButton: (await import('../../../functions/src/callable/clickButton'))
      .clickButton as unknown as Callable,
  };
  bootstrapUser = (await import('../../../functions/src/callable/bootstrapUser'))
    .bootstrapUser as unknown as Callable;
});

afterAll(async () => {
  if (priorApprovalFlag === undefined) delete process.env.ACCOUNT_APPROVAL_REQUIRED;
  else process.env.ACCOUNT_APPROVAL_REQUIRED = priorApprovalFlag;
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
});

describe.each([
  ['pending (no acct claim)', {}, 'pending'],
  ['pending (unknown acct value)', { acct: 'maybe' }, 'pending'],
  ['blocked', { acct: 'blocked' }, 'blocked'],
  ['blocked admin', { acct: 'blocked', admin: true }, 'blocked'],
])('a %s token', (_label, claims, status) => {
  it.each(calls)('is refused by %s with account-not-approved', async (name, data) => {
    const error = await failure(callables[name].run(request(USERS.owner, claims, data)));
    expect(error.code).toBe('permission-denied');
    expect(error.details).toEqual({ reason: 'account-not-approved', status });
  });

  it('a refused createInvite writes nothing', async () => {
    await failure(callables.createInvite.run(request(USERS.owner, claims, inviteData)));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { collection, getDocs } = await import('firebase/firestore');
      const invites = await getDocs(collection(ctx.firestore(), 'workspaces', WS, 'invites'));
      expect(invites.size).toBe(0);
    });
  });
});

describe('an approved token', () => {
  it('passes the gate: the workspace owner can create an invite', async () => {
    const result = (await callables.createInvite.run(
      request(USERS.owner, { acct: 'approved' }, inviteData),
    )) as { inviteId: string };
    expect(result.inviteId).toBeTruthy();
  });

  it.each(calls.filter(([name]) => name !== 'createInvite'))(
    'passes the gate of %s (any later error is not account-not-approved)',
    async (name, data) => {
      const error = await failure(
        callables[name].run(request(USERS.owner, { acct: 'approved' }, data)),
      );
      expect(JSON.stringify(error.details ?? null)).not.toContain('account-not-approved');
    },
  );
});

describe('bootstrapUser stays open to every state', () => {
  it.each([
    ['pending', {}, 'pending'],
    ['blocked', { acct: 'blocked' }, 'blocked'],
  ])('returns the %s status instead of refusing', async (_label, claims, status) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'users', 'someone'), {
        displayName: 'Someone',
        email: 'someone@example.com',
        photoURL: null,
        timezone: 'UTC',
        locale: 'en',
        lastWorkspaceId: null,
        theme: 'system',
        accountStatus: status,
        createdAt: new Date(1_700_000_000_000),
      });
    });
    const result = (await bootstrapUser.run(request('someone', claims, {}))) as {
      accountStatus?: string;
      workspaceId?: string;
    };
    expect(result.accountStatus).toBe(status);
    expect(result.workspaceId).toBeUndefined();
  });
});
