import { onRequest } from 'firebase-functions/v2/https';
import { db } from '../lib/admin';
import { createAdminClient } from './admin-client';
import { connectorEnabled, createMcpApp } from './app';
import { MinuteLimiter, adminUsageStore } from './limits';
import { adminMcpStore } from './oauth/admin-store';
import type { McpStore } from './oauth/store';
import { createService } from '@atrium/mcp-core';

/**
 * The hosted MCP connector (OPS4): one public HTTPS function behind Hosting rewrites. It ships
 * disabled; `MCP_CONNECTOR_ENABLED=true` in `functions/.env.atrium-board` switches it on. To stop
 * it instantly, remove the `allUsers` `roles/run.invoker` binding from the `mcp` Cloud Run service.
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

const store = lazy<McpStore>(() => adminMcpStore(db()));
const usage = lazy(() => adminUsageStore(db()));

const app = createMcpApp({
  store,
  isEnabled: connectorEnabled,
  server: {
    createService: (uid) =>
      createService({
        client: createAdminClient(db()),
        actor: { uid, workspaceFilter: null },
      }),
    usage,
    limiter: new MinuteLimiter(),
    audit: store,
    now: Date.now,
  },
});

export const mcp = onRequest(
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
