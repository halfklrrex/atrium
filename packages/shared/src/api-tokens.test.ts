import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_NAME_MAX,
  apiTokenSchema,
  createApiTokenRequestSchema,
  createApiTokenResultSchema,
  revokeApiTokenRequestSchema,
} from './api-tokens';

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000), toMillis: () => 1000 };
const valid = { name: 'Shortcuts', scopes: ['read'], expiresInDays: 90 };

describe('createApiTokenRequestSchema', () => {
  it('accepts a minimal request and trims the name', () => {
    expect(createApiTokenRequestSchema.parse({ ...valid, name: '  Shortcuts ' }).name).toBe(
      'Shortcuts',
    );
  });
  it('accepts write scope and workspace ids', () => {
    expect(
      createApiTokenRequestSchema.safeParse({
        ...valid,
        scopes: ['read', 'write'],
        workspaceIds: ['w1', 'w2'],
      }).success,
    ).toBe(true);
  });
  it.each([30, 90, 365])('accepts %i days', (days) => {
    expect(createApiTokenRequestSchema.safeParse({ ...valid, expiresInDays: days }).success).toBe(
      true,
    );
  });
  it.each([0, 7, 366, 3650, '90', null])('rejects expiry %p (no "never")', (days) => {
    expect(createApiTokenRequestSchema.safeParse({ ...valid, expiresInDays: days }).success).toBe(
      false,
    );
  });
  it('rejects empty, blank and long names', () => {
    expect(createApiTokenRequestSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(createApiTokenRequestSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
    expect(
      createApiTokenRequestSchema.safeParse({ ...valid, name: 'a'.repeat(API_TOKEN_NAME_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      createApiTokenRequestSchema.safeParse({ ...valid, name: 'a'.repeat(API_TOKEN_NAME_MAX) })
        .success,
    ).toBe(true);
  });
  it('rejects empty, unknown and duplicate scopes', () => {
    for (const scopes of [[], ['admin'], ['read', 'read'], ['read', 'write', 'read']]) {
      expect(createApiTokenRequestSchema.safeParse({ ...valid, scopes }).success).toBe(false);
    }
  });
  it('rejects unknown keys', () => {
    expect(createApiTokenRequestSchema.safeParse({ ...valid, uid: 'x' }).success).toBe(false);
  });
});

describe('result and doc schemas', () => {
  it('requires the atrp_ prefix on the returned token', () => {
    const base = { tokenId: 't1', prefix: 'atrp_abc', expiresAt: 5 };
    expect(createApiTokenResultSchema.safeParse({ ...base, token: 'atrp_abcdef' }).success).toBe(
      true,
    );
    expect(createApiTokenResultSchema.safeParse({ ...base, token: 'atr_abcdef' }).success).toBe(
      false,
    );
  });
  it('parses a revoke request', () => {
    expect(revokeApiTokenRequestSchema.safeParse({ tokenId: 't1' }).success).toBe(true);
    expect(revokeApiTokenRequestSchema.safeParse({}).success).toBe(false);
  });
  it('parses a token document with and without a workspace restriction', () => {
    const doc = {
      name: 'x',
      prefix: 'atrp_abc',
      scopes: ['read'],
      workspaceIds: null,
      createdAt: ts,
      expiresAt: ts,
      lastUsedAt: null,
      revokedAt: null,
    };
    expect(apiTokenSchema.safeParse(doc).success).toBe(true);
    expect(apiTokenSchema.safeParse({ ...doc, workspaceIds: ['w1'] }).success).toBe(true);
  });
});
