import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpService } from '@atrium/mcp-core';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { MCP_RESOURCE_METADATA_URL, createMcpApp } from './app';
import { MinuteLimiter, usageDay, type UsageStore, type UsageVerdict } from './limits';
import { authorizeRequest } from './oauth/consent';
import { MCP_RESOURCE_URL } from './oauth/constants';
import { FakeMcpStore } from './oauth/fake-store';
import {
  DAILY_LIMIT_MESSAGE,
  READ_ONLY_MESSAGE,
  UNEXPECTED_MESSAGE,
  buildServerFor,
  stripControlChars,
  type ServerDeps,
} from './server';

const UID = 'u1';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const ORIGIN = 'https://atrium-workboards.web.app';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

/** A usage store in memory that applies the same caps as the Firestore one. */
class FakeUsage implements UsageStore {
  calls = 0;
  writes = 0;
  constructor(
    private caps = { calls: 2000, writes: 500 },
    readonly seen: { day: string; write: boolean }[] = [],
  ) {}
  async consume(_uid: string, day: string, write: boolean): Promise<UsageVerdict> {
    this.seen.push({ day, write });
    if (this.calls >= this.caps.calls) return 'calls';
    if (write && this.writes >= this.caps.writes) return 'writes';
    this.calls += 1;
    if (write) this.writes += 1;
    return 'ok';
  }
}

interface Options {
  enabled?: boolean;
  /** Put a body parser in front, the way the Functions framework does. */
  preParse?: boolean;
  service?: Partial<McpService>;
  limiterMax?: number;
  usage?: UsageStore;
}

async function start(options: Options = {}) {
  const store = new FakeMcpStore();
  store.accounts.set(UID, 'approved');
  const clock = { now: Date.now() };
  const state = { enabled: options.enabled ?? true };
  const usage = options.usage ?? new FakeUsage();
  const service = {
    listWorkspaces: async () => ({ workspaces: [{ id: 'w1', name: 'Home', role: 'owner' }] }),
    getBoard: async () => ({ name: 'Tab\tBoard\u0007\u001b[31mX' }),
    createBoard: async () => ({ id: 'b-new' }),
    ...options.service,
  } as unknown as McpService;
  const serverDeps: ServerDeps = {
    createService: () => service,
    usage,
    limiter: new MinuteLimiter(options.limiterMax ?? 60, () => clock.now),
    audit: store,
    now: () => clock.now,
  };
  const mcp = createMcpApp({ store, server: serverDeps, isEnabled: () => state.enabled });
  const outer = express();
  if (options.preParse) outer.use(express.urlencoded({ extended: false }), express.json());
  outer.use(mcp);
  const server = createServer(outer);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { store, clock, state, usage, base };
}

type Harness = Awaited<ReturnType<typeof start>>;

/** Registers, authorizes (checking the 302), consents and exchanges, all over HTTP. */
async function connect(h: Harness, scopes: string[] = ['atrium:read', 'atrium:write']) {
  const reg = await fetch(`${h.base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      client_name: 'Claude',
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URL(`${h.base}/authorize`);
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st',
    resource: MCP_RESOURCE_URL,
    scope: 'atrium:read atrium:write',
  })) {
    authorize.searchParams.set(key, value);
  }
  const auth = await fetch(authorize, { redirect: 'manual' });
  expect(auth.status).toBe(302);
  const location = new URL(auth.headers.get('location')!);
  expect(`${location.origin}${location.pathname}`).toBe(`${ORIGIN}/connect`);
  const requestId = location.searchParams.get('request')!;

  const { redirectUrl } = await authorizeRequest(h.store, h.clock.now, UID, {
    requestId,
    decision: 'allow',
    scopes: scopes as ('atrium:read' | 'atrium:write')[],
  });
  const code = new URL(redirectUrl).searchParams.get('code')!;

  const token = await fetch(`${h.base}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      resource: MCP_RESOURCE_URL,
    }),
  });
  const body = (await token.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
    token_type: string;
  };
  return { status: token.status, body, clientId: client.client_id };
}

let nextId = 1;
async function rpc(h: Harness, token: string | null, method: string, params?: unknown) {
  const res = await fetch(`${h.base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return res;
}

async function callTool(h: Harness, token: string, name: string, args: unknown = {}) {
  const res = await rpc(h, token, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    result: { isError?: boolean; content: { type: string; text: string }[] };
  };
  return json.result;
}

describe('kill switch', () => {
  const routes: [string, string][] = [
    ['GET', '/.well-known/oauth-authorization-server'],
    ['GET', '/.well-known/oauth-protected-resource/mcp'],
    ['GET', '/authorize'],
    ['POST', '/token'],
    ['POST', '/register'],
    ['POST', '/revoke'],
    ['POST', '/mcp'],
    ['GET', '/mcp'],
    ['DELETE', '/mcp'],
    ['GET', '/anything-else'],
  ];

  it('answers 503 connector_disabled with no-store on every route and touches nothing', async () => {
    const h = await start({ enabled: false });
    for (const [method, path] of routes) {
      const res = await fetch(`${h.base}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(res.headers.get('cache-control'), `${method} ${path}`).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'connector_disabled' });
    }
    expect(h.store.clients.size + h.store.requests.size + h.store.tokens.size).toBe(0);
  });

  it('is read on every request, so flipping it takes effect without a restart', async () => {
    const h = await start({ enabled: false });
    expect((await fetch(`${h.base}/mcp`, { method: 'POST' })).status).toBe(503);
    h.state.enabled = true;
    expect((await fetch(`${h.base}/mcp`, { method: 'POST' })).status).toBe(401);
  });
});

describe('metadata documents', () => {
  it('serves the exact authorization-server metadata', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      // The SDK serializes the issuer URL, so it carries the trailing slash (the PRM lists it the same).
      issuer: `${ORIGIN}/`,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      scopes_supported: ['atrium:read', 'atrium:write'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // The SDK always advertises client_secret_post; registration forces public clients (none).
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      code_challenge_methods_supported: ['S256'],
      revocation_endpoint: `${ORIGIN}/revoke`,
      revocation_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  });

  it('serves the exact protected-resource metadata', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: MCP_RESOURCE_URL,
      authorization_servers: [`${ORIGIN}/`],
      scopes_supported: ['atrium:read', 'atrium:write'],
      resource_name: 'Atrium',
    });
  });
});

describe('POST /mcp authentication', () => {
  it('answers 401 with a resource_metadata challenge when there is no token', async () => {
    const h = await start();
    const res = await rpc(h, null, 'tools/list');
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate')!;
    expect(header).toMatch(/^Bearer /);
    expect(header).toContain(`resource_metadata="${MCP_RESOURCE_METADATA_URL}"`);
    expect(MCP_RESOURCE_METADATA_URL).toBe(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
    expect(header).toBe(
      `Bearer error="invalid_token", error_description="Missing Authorization header", scope="atrium:read atrium:write", resource_metadata="${MCP_RESOURCE_METADATA_URL}"`,
    );
    expect(header).toContain('error="invalid_token"');
  });

  it('answers 401 for a token that does not exist', async () => {
    const h = await start();
    const res = await rpc(h, 'atr_not-a-token', 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('verifies a real token and lists every tool', async () => {
    const h = await start();
    const { status, body } = await connect(h);
    expect(status).toBe(200);
    expect(body.token_type.toLowerCase()).toBe('bearer');
    const res = await rpc(h, body.access_token, 'tools/list');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { tools: { name: string }[] } };
    const names = json.result.tools.map((tool) => tool.name);
    expect(names).toHaveLength(25);
    expect(names).toContain('atrium_list_workspaces');
  });

  it('rejects a pending or blocked account with 401 invalid_token', async () => {
    const h = await start();
    const { body } = await connect(h);
    for (const status of ['pending', 'blocked'] as const) {
      h.store.accounts.set(UID, status);
      h.clock.now += 61 * 1000; // past the 60 s account cache
      const res = await rpc(h, body.access_token, 'tools/list');
      expect(res.status, status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    }
  });

  it('rejects an expired token', async () => {
    const h = await start();
    const { body } = await connect(h);
    h.clock.now += 2 * 60 * 60 * 1000;
    expect((await rpc(h, body.access_token, 'tools/list')).status).toBe(401);
  });
});

describe('other methods and routes', () => {
  it('answers 405 with Allow: POST on GET and DELETE /mcp', async () => {
    const h = await start();
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const res = await fetch(`${h.base}/mcp`, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });

  it('answers 404 JSON on unknown routes', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('sends no CORS headers', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/mcp`, {
      method: 'POST',
      headers: { origin: 'https://x.test' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('/token under a body parser', () => {
  it.each([
    ['its own urlencoded parser', false],
    ['a body parser in front (as the Functions framework does)', true],
  ])('exchanges a code sent form-urlencoded with %s', async (_label, preParse) => {
    const h = await start({ preParse });
    const { status, body } = await connect(h);
    expect(status).toBe(200);
    expect(body.access_token).toMatch(/^atr_/);
    expect(body.refresh_token).toMatch(/^atr_/);
    expect(body.scope).toBe('atrium:read atrium:write');

    const refreshed = await fetch(`${h.base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: body.refresh_token,
        client_id: [...h.store.clients.keys()][0]!,
      }),
    });
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as { access_token: string }).access_token).not.toBe(
      body.access_token,
    );
  });
});

describe('tools', () => {
  it('runs a read tool and audits the call without any token', async () => {
    const h = await start();
    const { body, clientId } = await connect(h);
    const result = await callTool(h, body.access_token, 'atrium_list_workspaces');
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      workspaces: [{ id: 'w1', name: 'Home', role: 'owner' }],
    });
    const calls = h.store.audit.filter((entry) => entry.kind === 'tool_call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tool: 'atrium_list_workspaces',
      uid: UID,
      clientId,
      ok: true,
    });
    expect(calls[0]!.ms).toBeGreaterThanOrEqual(0);
    expect(calls[0]!.grantId).toBeTruthy();
    expect(JSON.stringify(h.store.audit)).not.toContain(body.access_token);
    expect(JSON.stringify(h.store.audit)).not.toContain(body.refresh_token);
  });

  it('records the boardId of a call and strips control characters from the result', async () => {
    const h = await start();
    const { body } = await connect(h);
    const result = await callTool(h, body.access_token, 'atrium_get_board', { boardId: 'board1' });
    expect(JSON.parse(result.content[0]!.text)).toEqual({ name: 'Tab\tBoard[31mX' });
    expect(h.store.audit.find((entry) => entry.tool === 'atrium_get_board')).toMatchObject({
      boardId: 'board1',
      ok: true,
    });
  });

  it('refuses a write tool on a read-only connection, and still lets reads through', async () => {
    const h = await start();
    const { body } = await connect(h, ['atrium:read']);
    expect(body.scope).toBe('atrium:read');
    const denied = await callTool(h, body.access_token, 'atrium_create_board', { name: 'X' });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toBe(READ_ONLY_MESSAGE);
    expect(h.store.audit.at(-1)).toMatchObject({
      tool: 'atrium_create_board',
      ok: false,
      error: 'read_only',
    });
    const allowed = await callTool(h, body.access_token, 'atrium_list_workspaces');
    expect(allowed.isError).toBeUndefined();
  });

  it('lets a write tool run with atrium:write', async () => {
    const h = await start();
    const { body } = await connect(h);
    const ok = await callTool(h, body.access_token, 'atrium_create_board', { name: 'X' });
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse(ok.content[0]!.text)).toEqual({ id: 'b-new' });
  });

  it('returns a McpUserError as a plain tool error', async () => {
    const { McpUserError } = await import('@atrium/mcp-core');
    const h = await start({
      service: {
        getBoard: async () => {
          throw new McpUserError('Board not found.');
        },
      },
    });
    const { body } = await connect(h);
    const result = await callTool(h, body.access_token, 'atrium_get_board', { boardId: 'b1' });
    expect(result).toMatchObject({ isError: true, content: [{ text: 'Board not found.' }] });
    expect(h.store.audit.at(-1)).toMatchObject({ ok: false, error: 'user_error' });
  });

  it('hides an unexpected error behind a generic message', async () => {
    const h = await start({
      service: {
        getBoard: async () => {
          throw new Error('secret internal detail');
        },
      },
    });
    const { body } = await connect(h);
    const result = await callTool(h, body.access_token, 'atrium_get_board', { boardId: 'b1' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(UNEXPECTED_MESSAGE);
    expect(h.store.audit.at(-1)).toMatchObject({ ok: false, error: 'unexpected' });
  });
});

describe('usage limits', () => {
  it('allows 60 calls a minute per user, then recovers after the window', async () => {
    const h2 = await start({ limiterMax: 3 });
    const t = (await connect(h2)).body.access_token;
    for (let i = 0; i < 3; i += 1) {
      expect((await callTool(h2, t, 'atrium_list_workspaces')).isError).toBeUndefined();
    }
    const limited = await callTool(h2, t, 'atrium_list_workspaces');
    expect(limited.isError).toBe(true);
    expect(limited.content[0]!.text).toMatch(/Too many requests/);
    expect(h2.store.audit.at(-1)).toMatchObject({ ok: false, error: 'rate_limited' });
    h2.clock.now += 61 * 1000;
    expect((await callTool(h2, t, 'atrium_list_workspaces')).isError).toBeUndefined();
  });

  it('stops at the daily call cap with "Daily limit reached"', async () => {
    const usage = new FakeUsage({ calls: 2, writes: 500 });
    const h = await start({ usage });
    const { body } = await connect(h);
    await callTool(h, body.access_token, 'atrium_list_workspaces');
    await callTool(h, body.access_token, 'atrium_list_workspaces');
    const limited = await callTool(h, body.access_token, 'atrium_list_workspaces');
    expect(limited.isError).toBe(true);
    expect(limited.content[0]!.text).toBe(DAILY_LIMIT_MESSAGE);
    expect(limited.content[0]!.text).toMatch(/^Daily limit reached/);
    expect(h.store.audit.at(-1)).toMatchObject({ ok: false, error: 'daily_limit' });
    expect(usage.seen[0]).toEqual({ day: usageDay(h.clock.now), write: false });
  });

  it('caps writes separately from reads', async () => {
    const usage = new FakeUsage({ calls: 2000, writes: 1 });
    const h = await start({ usage });
    const { body } = await connect(h);
    expect(
      (await callTool(h, body.access_token, 'atrium_create_board', { name: 'A' })).isError,
    ).toBeUndefined();
    const second = await callTool(h, body.access_token, 'atrium_create_board', { name: 'B' });
    expect(second.content[0]!.text).toMatch(/^Daily limit reached/);
    expect(
      (await callTool(h, body.access_token, 'atrium_list_workspaces')).isError,
    ).toBeUndefined();
    expect(usage.seen.filter((entry) => entry.write)).toHaveLength(2);
  });

  it('does not count a call the scope check refused', async () => {
    const usage = new FakeUsage();
    const h = await start({ usage });
    const { body } = await connect(h, ['atrium:read']);
    await callTool(h, body.access_token, 'atrium_create_board', { name: 'A' });
    expect(usage.seen).toHaveLength(0);
  });
});

describe('stripControlChars', () => {
  it('removes C0 controls except tab and newline, deeply', () => {
    expect(
      stripControlChars({ 'a\u0001': ['x\u0000y\tz\nw\r\u001f', 5, null, { k: 'v\u007f' }] }),
    ).toEqual({ a: ['xy\tz\nw', 5, null, { k: 'v\u007f' }] });
  });
});

describe('buildServerFor', () => {
  it('registers every tool of the catalogue', async () => {
    const { defineTools } = await import('@atrium/mcp-core');
    const store = new FakeMcpStore();
    const server = buildServerFor(
      {
        token: 't',
        clientId: 'c',
        scopes: ['atrium:read'],
        extra: { uid: UID, grantId: 'g' },
      },
      {
        createService: () => ({}) as McpService,
        usage: new FakeUsage(),
        limiter: new MinuteLimiter(),
        audit: store,
        now: Date.now,
      },
    );
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    );
    expect(registered.sort()).toEqual(
      defineTools({} as McpService)
        .map((tool) => tool.name)
        .sort(),
    );
  });
});
