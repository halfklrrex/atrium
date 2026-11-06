import { describe, expect, it } from 'vitest';
import {
  bootstrapUserResultSchema,
  listAccountsRequestSchema,
  listAccountsResultSchema,
  notificationKindSchema,
  setAccountStatusRequestSchema,
  setAccountStatusResultSchema,
} from './index';

describe('account admin schemas', () => {
  it('setAccountStatus accepts approved and blocked only, strictly', () => {
    const parse = (v: unknown) => setAccountStatusRequestSchema.safeParse(v).success;
    expect(parse({ uid: 'u1', status: 'approved' })).toBe(true);
    expect(parse({ uid: 'u1', status: 'blocked' })).toBe(true);
    expect(parse({ uid: 'u1', status: 'pending' })).toBe(false);
    expect(parse({ uid: 'u1', status: 'blocked', admin: true })).toBe(false);
    expect(parse({ status: 'blocked' })).toBe(false);
    expect(
      setAccountStatusResultSchema.safeParse({ uid: 'u1', status: 'approved', changed: false })
        .success,
    ).toBe(true);
  });

  it('listAccounts request is optional paging, strict', () => {
    const parse = (v: unknown) => listAccountsRequestSchema.safeParse(v).success;
    expect(parse({})).toBe(true);
    expect(parse({ pageToken: 't', pageSize: 100 })).toBe(true);
    expect(parse({ pageSize: 101 })).toBe(false);
    expect(parse({ pageSize: 0 })).toBe(false);
    expect(parse({ extra: 1 })).toBe(false);
  });

  it('listAccounts result rejects unknown fields', () => {
    const account = {
      uid: 'u1',
      displayName: 'Avery Quinn',
      email: 'avery@example.com',
      photoURL: null,
      status: 'pending',
      createdAt: '2026-11-06T10:00:00.000Z',
      lastSignInAt: null,
    };
    const parse = (v: unknown) => listAccountsResultSchema.safeParse(v).success;
    expect(parse({ accounts: [account], nextPageToken: null })).toBe(true);
    expect(parse({ accounts: [{ ...account, claims: {} }], nextPageToken: null })).toBe(false);
  });
});

describe('ADMIN-2 compatible additions', () => {
  it('bootstrapUser result keeps old shapes valid and allows a status', () => {
    const parse = (v: unknown) => bootstrapUserResultSchema.safeParse(v).success;
    expect(parse({ workspaceId: 'w1' })).toBe(true);
    expect(parse({ accountStatus: 'pending' })).toBe(true);
    expect(parse({ workspaceId: 'w1', accountStatus: 'approved' })).toBe(true);
    expect(parse({ accountStatus: 'nope' })).toBe(false);
  });

  it('has the account notification kinds', () => {
    expect(notificationKindSchema.options).toContain('account_request');
    expect(notificationKindSchema.options).toContain('account_approved');
  });
});
