import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createService } from '@atrium/mcp-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as AdminClientModule from '../../../functions/src/mcp/admin-client';
import type * as AppModule from '../../../functions/src/mcp/app';
import type * as LimitsModule from '../../../functions/src/mcp/limits';
import type * as StoreModule from '../../../functions/src/mcp/oauth/admin-store';
import type * as ConsentModule from '../../../functions/src/mcp/oauth/consent';
import type * as ConstantsModule from '../../../functions/src/mcp/oauth/constants';

/**
 * End to end against the Firestore emulator (OPS4 PR E): the real Express app of the `mcp` function
 * (kill switch, SDK OAuth router, bearer middleware, per-request MCP server) over the real Admin SDK
 * store, usage counters and Firestore client, driven over HTTP by the MCP SDK's own client.
 * Flow: /register -> /authorize (302 to /connect) -> consent logic as an approved user -> /token
 * (form-urlencoded) -> tools/list and atrium_list_workspaces with the issued token.
 * Runs through `pnpm test:rules`, which provides FIRESTORE_EMULATOR_HOST.
 */

let admin: typeof AdminModule;
let adminClient: typeof AdminClientModule;
let app: typeof AppModule;
let limits: typeof LimitsModule;
let stores: typeof StoreModule;
let consent: typeof ConsentModule;
let constants: typeof ConstantsModule;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
let server: Server | undefined;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  admin = await import('../../../functions/src/lib/admin');
  adminClient = await import('../../../functions/src/mcp/admin-client');
  app = await import('../../../functions/src/mcp/app');
  limits = await import('../../../functions/src/mcp/limits');
  stores = await import('../../../functions/src/mcp/oauth/admin-store');
  consent = await import('../../../functions/src/mcp/oauth/consent');
  constants = await import('../../../functions/src/mcp/oauth/constants');
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe('the mcp function against the emulator', () => {
  it('connects a client end to end and serves its workspaces', async () => {
    const firestore = admin.db();
    const suffix = randomUUID().slice(0, 8);
    const uid = `mcpfn-${suffix}`;
    const workspaceId = `mcpws-${suffix}`;
    await firestore
      .collection('users')
      .doc(uid)
      .set({ displayName: 'Avery Quinn', email: 'avery@example.com', accountStatus: 'approved' });
    await firestore
      .collection('workspaces')
      .doc(workspaceId)
      .set({
        name: 'Team',
        description: '',
        icon: 'T',
        color: '#6161ff',
        ownerId: uid,
        memberIds: [uid],
        roles: { [uid]: 'owner' },
        kind: 'open',
        createdBy: uid,
      });

    const store = stores.adminMcpStore(firestore);
    const mcpApp = app.createMcpApp({
      store,
      isEnabled: () => true,
      server: {
        // Same wiring as functions/src/mcp/index.ts.
        createService: (who) =>
          createService({
            client: adminClient.createAdminClient(firestore),
            actor: { uid: who, workspaceFilter: null },
          }),
        usage: limits.adminUsageStore(firestore),
        limiter: new limits.MinuteLimiter(),
        audit: store,
        now: Date.now,
      },
    });
    server = createServer(mcpApp);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Dynamic client registration.
    const registered = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [REDIRECT],
        client_name: 'Claude',
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(registered.status).toBe(201);
    const { client_id: clientId } = (await registered.json()) as { client_id: string };

    // Authorize: parked, then redirected to the consent page.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorizeUrl = new URL(`${base}/authorize`);
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'st',
      resource: constants.MCP_RESOURCE_URL,
      scope: 'atrium:read atrium:write',
    })) {
      authorizeUrl.searchParams.set(key, value);
    }
    const authorized = await fetch(authorizeUrl, { redirect: 'manual' });
    expect(authorized.status).toBe(302);
    const location = new URL(authorized.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(`${constants.ATRIUM_ORIGIN}/connect`);
    const requestId = location.searchParams.get('request')!;
    expect(requestId).toBeTruthy();

    // The consent callable's logic, as the signed-in approved user.
    const { redirectUrl } = await consent.authorizeRequest(store, Date.now(), uid, {
      requestId,
      decision: 'allow',
      scopes: ['atrium:read', 'atrium:write'],
    });
    const code = new URL(redirectUrl).searchParams.get('code')!;

    // Token exchange, form-urlencoded.
    const tokenResponse = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: clientId,
        redirect_uri: REDIRECT,
        resource: constants.MCP_RESOURCE_URL,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as { access_token: string; scope: string };
    expect(tokens.scope).toBe('atrium:read atrium:write');

    // The MCP SDK's own client over the Streamable HTTP transport.
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    });
    const client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(25);
      expect(tools.map((tool) => tool.name)).toContain('atrium_list_workspaces');

      const result = await client.callTool({ name: 'atrium_list_workspaces', arguments: {} });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0]!.text)).toEqual({
        workspaces: [{ id: workspaceId, name: 'Team', role: 'owner' }],
      });
    } finally {
      await client.close();
    }

    // The call was counted and audited, with no token anywhere.
    const usage = await firestore.collection('mcpUsage').doc(uid).get();
    expect(usage.get('calls')).toBeGreaterThanOrEqual(1);
    const audit = await firestore
      .collection('system')
      .doc('mcpAudit')
      .collection('entries')
      .where('uid', '==', uid)
      .where('kind', '==', 'tool_call')
      .get();
    expect(audit.docs.map((snap) => snap.get('tool'))).toContain('atrium_list_workspaces');
    for (const snap of audit.docs) {
      expect(snap.get('expiresAt').toMillis()).toBeGreaterThan(Date.now());
      expect(JSON.stringify(snap.data())).not.toContain(tokens.access_token);
    }

    // Without a token the endpoint challenges with the metadata URL.
    const anonymous = await fetch(`${base}/mcp`, { method: 'POST' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain(
      `resource_metadata="${app.MCP_RESOURCE_METADATA_URL}"`,
    );
  });
});
