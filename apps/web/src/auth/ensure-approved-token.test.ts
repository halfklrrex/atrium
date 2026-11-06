import { describe, expect, it, vi } from 'vitest';
import { ensureApprovedToken } from './ensure-approved-token';

function fakeUser(claims: Record<string, unknown>) {
  return {
    getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
    getIdToken: vi.fn().mockResolvedValue('token'),
  };
}

describe('ensureApprovedToken', () => {
  it('does nothing when the token already carries acct: approved', async () => {
    const user = fakeUser({ acct: 'approved' });
    expect(await ensureApprovedToken(user, 'approved')).toBe(false);
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  it('force-refreshes once when the server says approved but the token has no claim', async () => {
    const user = fakeUser({});
    expect(await ensureApprovedToken(user, 'approved')).toBe(true);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  it('treats a missing status (approval flag off) as approved', async () => {
    const user = fakeUser({ acct: 'blocked' });
    expect(await ensureApprovedToken(user, null)).toBe(true);
    expect(await ensureApprovedToken(fakeUser({}), undefined)).toBe(true);
  });

  it('leaves pending and blocked accounts alone', async () => {
    const user = fakeUser({});
    expect(await ensureApprovedToken(user, 'pending')).toBe(false);
    expect(await ensureApprovedToken(user, 'blocked')).toBe(false);
    expect(user.getIdTokenResult).not.toHaveBeenCalled();
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  it('never throws when reading or refreshing the token fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const user = fakeUser({});
    user.getIdToken.mockRejectedValue(new Error('network'));
    await expect(ensureApprovedToken(user, 'approved')).resolves.toBe(false);
    user.getIdTokenResult.mockRejectedValue(new Error('offline'));
    await expect(ensureApprovedToken(user, 'approved')).resolves.toBe(false);
  });
});
