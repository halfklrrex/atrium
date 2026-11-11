import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { authorizeRequest } from './consent';
import { MCP_RESOURCE_URL } from './constants';
import { FakeMcpStore } from './fake-store';
import { AtriumOAuthProvider } from './provider';

/** Shared fixtures for the OAuth unit tests (not bundled: nothing under `src/index.ts` imports it). */

export const T0 = Date.parse('2026-11-11T10:00:00.000Z');
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const LOOPBACK_REDIRECT = 'http://localhost:51234/callback';
export const UID = 'u1';

export interface Harness {
  store: FakeMcpStore;
  clock: { now: number };
  provider: AtriumOAuthProvider;
  register(redirectUris?: string[]): Promise<OAuthClientInformationFull>;
  /** Runs `provider.authorize` and returns the parked request id from the redirect. */
  startAuth(
    client: OAuthClientInformationFull,
    overrides?: Partial<{
      redirectUri: string;
      codeChallenge: string;
      state: string;
      scopes: string[];
      resource: URL | undefined;
    }>,
  ): Promise<{ requestId: string; redirectedTo: string }>;
  /** Runs the consent callable logic as `uid` and returns the code from the redirect URL. */
  consent(requestId: string, scopes?: string[], uid?: string): Promise<string>;
  /** Register, authorize, consent and exchange: a connected client. */
  connect(): Promise<{
    client: OAuthClientInformationFull;
    requestId: string;
    code: string;
    tokens: OAuthTokens;
    grantId: string;
  }>;
}

export function harness(): Harness {
  const store = new FakeMcpStore();
  store.accounts.set(UID, 'approved');
  const clock = { now: T0 };
  const provider = new AtriumOAuthProvider(store, { now: () => clock.now });

  const register: Harness['register'] = (redirectUris = [CLAUDE_REDIRECT]) =>
    provider.clientsStore.registerClient({
      redirect_uris: redirectUris,
      client_name: 'Claude',
      token_endpoint_auth_method: 'none',
    });

  const startAuth: Harness['startAuth'] = async (client, overrides = {}) => {
    const redirects: string[] = [];
    const params = {
      redirectUri: client.redirect_uris[0]!,
      codeChallenge: 'challenge-s256',
      state: 'state-1',
      scopes: ['atrium:read', 'atrium:write'],
      resource: new URL(MCP_RESOURCE_URL),
      ...overrides,
    };
    await provider.authorize(client, params, { redirect: (url) => redirects.push(url) });
    const redirectedTo = redirects[0]!;
    return { requestId: new URL(redirectedTo).searchParams.get('request')!, redirectedTo };
  };

  const consent: Harness['consent'] = async (requestId, scopes, uid = UID) => {
    const { redirectUrl } = await authorizeRequest(store, clock.now, uid, {
      requestId,
      decision: 'allow',
      ...(scopes ? { scopes: scopes as ('atrium:read' | 'atrium:write')[] } : {}),
    });
    return new URL(redirectUrl).searchParams.get('code')!;
  };

  const connect: Harness['connect'] = async () => {
    const client = await register();
    const { requestId } = await startAuth(client);
    const code = await consent(requestId);
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      CLAUDE_REDIRECT,
      new URL(MCP_RESOURCE_URL),
    );
    const grantId = store.requests.get(requestId)!.grantId!;
    return { client, requestId, code, tokens, grantId };
  };

  return { store, clock, provider, register, startAuth, consent, connect };
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Resolves to the thrown error, or fails when nothing was thrown. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a rejection');
}
