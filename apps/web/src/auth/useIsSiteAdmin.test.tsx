import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from './auth-context';
import { useIsSiteAdmin } from './useIsSiteAdmin';

function wrapperFor(user: unknown) {
  const value = { user } as unknown as AuthContextValue;
  return ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

describe('useIsSiteAdmin', () => {
  it('is true only with the admin claim, and false while loading', async () => {
    const user = {
      uid: 'u1',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { admin: true } }),
    };
    const { result } = renderHook(() => useIsSiteAdmin(), { wrapper: wrapperFor(user) });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false for an approved member without the claim', async () => {
    const user = {
      uid: 'u1',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { acct: 'approved' } }),
    };
    const { result } = renderHook(() => useIsSiteAdmin(), { wrapper: wrapperFor(user) });
    await waitFor(() => expect(user.getIdTokenResult).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('is false when signed out or when reading the token fails', async () => {
    const signedOut = renderHook(() => useIsSiteAdmin(), { wrapper: wrapperFor(null) });
    expect(signedOut.result.current).toBe(false);
    const broken = { uid: 'u1', getIdTokenResult: vi.fn().mockRejectedValue(new Error('x')) };
    const { result } = renderHook(() => useIsSiteAdmin(), { wrapper: wrapperFor(broken) });
    await waitFor(() => expect(broken.getIdTokenResult).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
