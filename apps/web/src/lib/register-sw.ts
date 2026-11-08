/**
 * Registers the minimal service worker (`/sw.js`, see docs/pwa.md).
 *
 * Production builds only: the Vite dev server, vitest and the Playwright visual runs (which use
 * the dev server) never register a worker. Failures are logged, never thrown.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('Service worker registration failed', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
