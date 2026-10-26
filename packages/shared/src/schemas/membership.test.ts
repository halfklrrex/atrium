import { describe, expect, it } from 'vitest';
import {
  assignableRoles,
  canRemoveMember,
  createInviteRequestSchema,
  invitableRoles,
} from './membership';

describe('invite request', () => {
  it('lowercases and trims the email', () => {
    const parsed = createInviteRequestSchema.parse({
      workspaceId: 'w1',
      email: '  Avery.Quinn@Example.COM ',
      role: 'member',
    });
    expect(parsed.email).toBe('avery.quinn@example.com');
  });

  it('refuses the owner role and bad emails', () => {
    expect(
      createInviteRequestSchema.safeParse({
        workspaceId: 'w1',
        email: 'a@example.com',
        role: 'owner',
      }).success,
    ).toBe(false);
    expect(
      createInviteRequestSchema.safeParse({ workspaceId: 'w1', email: 'nope', role: 'member' })
        .success,
    ).toBe(false);
  });
});

describe('permission matrix', () => {
  it('limits who can invite which role', () => {
    expect(invitableRoles('owner')).toEqual(['admin', 'member', 'viewer']);
    expect(invitableRoles('admin')).toEqual(['member', 'viewer']);
    expect(invitableRoles('member')).toEqual([]);
    expect(invitableRoles('viewer')).toEqual([]);
    expect(invitableRoles(null)).toEqual([]);
  });

  it('limits role changes', () => {
    expect(assignableRoles('owner', 'member', false)).toEqual(['owner', 'admin', 'viewer']);
    expect(assignableRoles('owner', 'owner', true)).toEqual([]);
    expect(assignableRoles('admin', 'viewer', false)).toEqual(['member']);
    expect(assignableRoles('admin', 'admin', false)).toEqual([]);
    expect(assignableRoles('admin', 'owner', false)).toEqual([]);
    expect(assignableRoles('member', 'viewer', false)).toEqual([]);
  });

  it('limits removal', () => {
    expect(canRemoveMember('owner', 'admin', false)).toBe(true);
    expect(canRemoveMember('owner', 'owner', true)).toBe(false);
    expect(canRemoveMember('admin', 'member', false)).toBe(true);
    expect(canRemoveMember('admin', 'admin', false)).toBe(false);
    expect(canRemoveMember('admin', 'owner', false)).toBe(false);
    expect(canRemoveMember('member', 'viewer', false)).toBe(false);
  });
});
