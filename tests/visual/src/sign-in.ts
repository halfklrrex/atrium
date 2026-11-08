import type { Page } from '@playwright/test';

/**
 * Signs `page` in through the Firebase SDK with email and password against the Auth emulator, the
 * way `global-setup.ts` does for the main user. The page must already be on an app URL (for example
 * `/login`) so that the app's own `auth` object and Vite's pre-bundled `firebase/auth` are loaded.
 */
export async function signInWithPassword(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.evaluate(async ({ email, password }) => {
    const appModule = '/src/lib/firebase.ts';
    const source = await (await fetch(appModule)).text();
    const authModule = /["']([^"']*firebase_auth\.js[^"']*)["']/.exec(source)?.[1];
    if (!authModule) throw new Error('Could not find the firebase/auth module URL');
    const { signInWithEmailAndPassword } = (await import(/* @vite-ignore */ authModule)) as {
      signInWithEmailAndPassword: (auth: unknown, email: string, password: string) => unknown;
    };
    const { auth } = (await import(/* @vite-ignore */ appModule)) as { auth: unknown };
    await signInWithEmailAndPassword(auth, email, password);
  }, credentials);
}
