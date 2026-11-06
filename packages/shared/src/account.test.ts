import { describe, expect, it } from 'vitest';
import {
  accountStatusFromClaims,
  accountStatusSchema,
  claimsForStatus,
  isAdminClaims,
  isApprovedClaims,
  mergeAccountClaims,
  userAccountFieldsSchema,
} from './account';

describe('claim helpers', () => {
  it('treats a missing acct claim as pending', () => {
    expect(accountStatusFromClaims({})).toBe('pending');
    expect(accountStatusFromClaims(null)).toBe('pending');
    expect(accountStatusFromClaims({ acct: 'weird' })).toBe('pending');
    expect(isApprovedClaims({})).toBe(false);
    expect(isApprovedClaims(undefined)).toBe(false);
  });

  it('reads approved and blocked', () => {
    expect(isApprovedClaims({ acct: 'approved' })).toBe(true);
    expect(isApprovedClaims({ acct: 'blocked' })).toBe(false);
    expect(accountStatusFromClaims({ acct: 'blocked' })).toBe('blocked');
  });

  it('isAdminClaims needs admin to be exactly true', () => {
    expect(isAdminClaims({ admin: true })).toBe(true);
    expect(isAdminClaims({ admin: 'true' })).toBe(false);
    expect(isAdminClaims({ admin: false })).toBe(false);
    expect(isAdminClaims({})).toBe(false);
    expect(isAdminClaims(null)).toBe(false);
  });

  it('claimsForStatus builds the claim set', () => {
    expect(claimsForStatus('approved')).toEqual({ acct: 'approved' });
    expect(claimsForStatus('blocked')).toEqual({ acct: 'blocked' });
    expect(claimsForStatus('pending')).toEqual({});
    expect(claimsForStatus('approved', true)).toEqual({ acct: 'approved', admin: true });
    expect(claimsForStatus('pending', true)).toEqual({ admin: true });
  });

  it('mergeAccountClaims keeps other claims and the admin flag', () => {
    expect(mergeAccountClaims({ other: 1, admin: true }, 'approved')).toEqual({
      other: 1,
      admin: true,
      acct: 'approved',
    });
    expect(mergeAccountClaims({ acct: 'blocked', other: 1 }, 'approved')).toEqual({
      other: 1,
      acct: 'approved',
    });
    expect(mergeAccountClaims({ acct: 'approved', admin: true }, 'approved', false)).toEqual({
      acct: 'approved',
    });
    expect(mergeAccountClaims({ acct: 'approved' }, 'pending')).toEqual({});
    expect(mergeAccountClaims(undefined, 'approved')).toEqual({ acct: 'approved' });
  });
});

describe('schemas', () => {
  it('accepts the three statuses only', () => {
    for (const s of ['pending', 'approved', 'blocked']) {
      expect(accountStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(accountStatusSchema.safeParse('banned').success).toBe(false);
  });

  it('makes the user account fields optional', () => {
    expect(userAccountFieldsSchema.safeParse({}).success).toBe(true);
    expect(
      userAccountFieldsSchema.safeParse({
        accountStatus: 'approved',
        statusChangedAt: { toMillis: () => 1 },
        statusChangedBy: 'system:backfill',
      }).success,
    ).toBe(true);
    expect(userAccountFieldsSchema.safeParse({ accountStatus: 'nope' }).success).toBe(false);
  });
});
