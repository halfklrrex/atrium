import { createService } from '@atrium/mcp-core';
import { onRequest } from 'firebase-functions/v2/https';
import { db } from '../lib/admin';
import { createAdminClient } from '../mcp/admin-client';
import { MinuteLimiter } from '../mcp/limits';
import { adminMcpStore } from '../mcp/oauth/admin-store';
import { AtriumOAuthProvider } from '../mcp/oauth/provider';
import { adminApiAuditStore } from './audit';
import { adminIdempotencyStore } from './idempotency';
import { adminApiTokenStore } from './admin-token-store';
import { apiEnabled, createApiApp } from './app';
import { verifyApiToken, type ApiAuthDeps } from './auth';
import {
  API_CALLS_PER_MINUTE,
  API_FAILED_AUTH_PER_HOUR,
  API_FAILED_AUTH_WINDOW_MS,
  adminApiUsageStore,
} from './limits';

/**
 * The public HTTP API (P8): one public HTTPS function behind the Hosting rewrite `/api/**`. It ships
 * disabled; `API_ENABLED=true` in `functions/.env.atrium-board` switches it on. To stop it
 * instantly, remove the `allUsers` `roles/run.invoker` binding from the `api` Cloud Run service.
 *
 * Firestore is touched lazily, on the first request that passes the kill switch.
 */
function lazy<T extends object>(factory: () => T): T {
  let value: T | undefined;
  const get = () => (value ??= factory());
  return new Proxy({} as T, {
    get: (_target, key) => {
      const target = get();
      const member = Reflect.get(target, key) as unknown;
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

const tokenStore = lazy(() => adminApiTokenStore(db()));
const oauth = lazy(() => new AtriumOAuthProvider(adminMcpStore(db())));
const usage = lazy(() => adminApiUsageStore(db()));
const audit = lazy(() => adminApiAuditStore(db()));
const idempotency = lazy(() => adminIdempotencyStore(db()));

// One deps object per instance: `verifyApiToken` keeps its caches per deps object.
const authDeps: ApiAuthDeps = {
  store: tokenStore,
  verifyOAuthToken: (token) => oauth.verifyAccessToken(token),
};

const app = createApiApp({
  isEnabled: apiEnabled,
  verify: (header) => verifyApiToken(header, authDeps),
  createService: (auth) =>
    createService({
      client: createAdminClient(db()),
      // `null` is "no restriction"; a list (even an empty one) is exactly those workspaces.
      actor: { uid: auth.uid, workspaceFilter: auth.workspaceIds },
      // Names are display names or "A member", never an email address.
      hideEmails: true,
    }),
  usage,
  limiter: new MinuteLimiter(API_CALLS_PER_MINUTE),
  ipFailures: new MinuteLimiter(API_FAILED_AUTH_PER_HOUR, Date.now, API_FAILED_AUTH_WINDOW_MS),
  audit,
  idempotency,
  now: Date.now,
});

export const api = onRequest(
  {
    invoker: 'public',
    cors: false,
    timeoutSeconds: 55,
    memory: '512MiB',
    maxInstances: 3,
    minInstances: 0,
  },
  app,
);
