import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncMemberProfiles, runTransaction } = vi.hoisted(() => ({
  syncMemberProfiles: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase-functions/v2/https')>();
  // `onCall(handler)` returns the handler itself so the test can call it directly.
  return { ...actual, onCall: (handler: unknown) => handler };
});
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));
vi.mock('../lib/admin', () => ({
  db: () => ({
    runTransaction,
    doc: () => ({ get: () => Promise.resolve({ get: () => 'approved' }) }),
  }),
  adminBootstrapTx: vi.fn(),
}));
vi.mock('../lib/account-admin', () => ({
  afterUserCreated: vi.fn(),
  healApprovedClaim: vi.fn(),
}));
vi.mock('../lib/account-flag', () => ({ isApprovalRequired: () => true }));
vi.mock('../lib/admin-account', () => ({ adminAccountAuth: vi.fn() }));
vi.mock('../lib/admin-notifications', () => ({ adminNotificationStore: vi.fn() }));
vi.mock('../lib/bootstrap', () => ({ bootstrapUserInTransaction: vi.fn() }));
vi.mock('../lib/membership', () => ({ syncMemberProfiles }));
vi.mock('../lib/membership-admin', () => ({ adminMemberProfileStore: vi.fn() }));

import type { CallableRequest } from 'firebase-functions/v2/https';
import { bootstrapUser } from './bootstrapUser';

const handler = bootstrapUser as unknown as (request: CallableRequest) => Promise<unknown>;

const request = (claims: Record<string, unknown> | null) =>
  ({
    data: {},
    auth: claims ? { uid: 'u1', token: { name: 'Avery Quinn', ...claims } } : undefined,
  }) as unknown as CallableRequest;

beforeEach(() => {
  syncMemberProfiles.mockReset();
  runTransaction.mockReset();
  runTransaction.mockResolvedValue({ accountStatus: 'approved' });
});

describe('bootstrapUser', () => {
  it('syncs member profiles for an approved caller', async () => {
    await handler(request({ acct: 'approved' }));
    expect(syncMemberProfiles).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pending', {}],
    ['blocked', { acct: 'blocked' }],
  ])('works for a %s caller but never writes member profiles', async (_label, claims) => {
    await handler(request(claims));
    expect(runTransaction).toHaveBeenCalledTimes(1); // it ran: no account-not-approved refusal
    expect(syncMemberProfiles).not.toHaveBeenCalled();
  });

  it('still refuses a signed-out caller', async () => {
    await expect(handler(request(null))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
