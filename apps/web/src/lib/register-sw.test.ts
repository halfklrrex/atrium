import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register-sw';

describe('registerServiceWorker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does nothing outside production builds', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    vi.stubEnv('PROD', false);
    registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers /sw.js in production and only warns on failure', async () => {
    const register = vi.fn().mockRejectedValue(new Error('nope'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    vi.stubEnv('PROD', true);
    registerServiceWorker();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });

  it('does nothing without service worker support', () => {
    vi.stubGlobal('navigator', {});
    vi.stubEnv('PROD', true);
    expect(() => registerServiceWorker()).not.toThrow();
  });
});
