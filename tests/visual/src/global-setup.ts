import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { CONTEXT_OPTIONS, makeDeterministic, settle, setTheme } from './determinism';
import {
  AUTH_HOST,
  FIRESTORE_HOST,
  FUNCTIONS_REGION,
  FUNCTIONS_URL,
  PROJECT_ID,
  STORAGE_STATE,
  WEB_URL,
} from './env';
import { AVERY, seed } from './seed';

/** Poll until `check` resolves truthy; the message names what never came up. */
async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}${lastError ? `: ${String(lastError)}` : ''}`);
}

const httpOk = (url: string) => async () => (await fetch(url)).ok;

/** The signed-in user's ID token, straight from the Auth emulator's REST API. */
async function idToken(): Promise<string> {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: AVERY.email,
        password: AVERY.password,
        returnSecureToken: true,
      }),
    },
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error('The Auth emulator did not return an ID token');
  return body.idToken;
}

export default async function globalSetup(): Promise<void> {
  // Playwright's webServer has the emulators and Vite answering HTTP by now; the callable functions
  // load a little later, so wait for the real thing: bootstrapUser answering a signed-in call.
  await waitFor('the Auth emulator', httpOk(`http://${AUTH_HOST}/`));
  await waitFor('the Firestore emulator', httpOk(`http://${FIRESTORE_HOST}/`));

  await seed();

  await waitFor('the bootstrapUser function', async () => {
    const response = await fetch(
      `${FUNCTIONS_URL}/${PROJECT_ID}/${FUNCTIONS_REGION}/bootstrapUser`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await idToken()}`,
        },
        body: JSON.stringify({ data: {} }),
      },
    );
    return response.ok;
  });

  // Sign in once through the Firebase SDK (email + password against the Auth emulator, exactly as
  // the app would), then keep the session so every test starts signed in.
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ...CONTEXT_OPTIONS, baseURL: WEB_URL });
    await makeDeterministic(context);
    await setTheme(context, 'light');
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome to Atrium' })).toBeVisible();

    await page.evaluate(
      async ({ email, password }) => {
        // The app has no sign-in hook for password accounts, so reuse the very modules it loaded
        // (same URLs, so the same instances): its `auth` object and Vite's pre-bundled firebase/auth.
        // Vite rewrites the bare `firebase/auth` import in the app's own module to a versioned URL;
        // read that URL from the served source so we import the instance the app already loaded.
        const appModule = '/src/lib/firebase.ts';
        const source = await (await fetch(appModule)).text();
        const authModule = /["']([^"']*firebase_auth\.js[^"']*)["']/.exec(source)?.[1];
        if (!authModule) throw new Error('Could not find the firebase/auth module URL');
        const { signInWithEmailAndPassword } = (await import(/* @vite-ignore */ authModule)) as {
          signInWithEmailAndPassword: (auth: unknown, email: string, password: string) => unknown;
        };
        const { auth } = (await import(/* @vite-ignore */ appModule)) as {
          auth: unknown;
        };
        await signInWithEmailAndPassword(auth, email, password);
      },
      { email: AVERY.email, password: AVERY.password },
    );

    await expect(page.getByText('Good morning, Avery!')).toBeVisible({ timeout: 30_000 });
    await settle(page);

    mkdirSync(dirname(STORAGE_STATE), { recursive: true });
    await context.storageState({ path: STORAGE_STATE, indexedDB: true });
  } finally {
    await browser.close();
  }
}
