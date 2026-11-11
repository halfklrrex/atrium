import {
  MCP_READ_SCOPE,
  type McpAuthRequestInfoRequest,
  type McpAuthRequestInfoResult,
  type McpAuthorizeRequest,
  type McpAuthorizeResult,
  type McpScope,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { writeMcpAudit } from './audit';
import type { McpStore } from './store';
import { hashSecret, newAuthCode } from './tokens';

/**
 * The consent page's two callables (OPS4 section 4.1, steps 3 and 4). The callables themselves
 * add `actorFromRequest` (approved accounts only) and zod parsing; this is the logic, tested with
 * the fake store.
 */

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

export function redirectHostOf(redirectUri: string): { host: string; loopback: boolean } {
  try {
    const url = new URL(redirectUri);
    return { host: url.host, loopback: LOOPBACK_HOSTS.has(url.hostname) };
  } catch {
    return { host: '', loopback: false };
  }
}

const expired = (code: 'not-found' | 'failed-precondition') =>
  new HttpsError(code, 'This connection request has expired. Start again from Claude.', {
    reason: 'request-expired',
  });

/** What the consent page shows. Anything but a pending, unexpired request reads as expired. */
export async function authRequestInfo(
  store: Pick<McpStore, 'getAuthRequest'>,
  now: number,
  input: McpAuthRequestInfoRequest,
): Promise<McpAuthRequestInfoResult> {
  const request = await store.getAuthRequest(input.requestId);
  if (!request || request.status !== 'pending' || request.expiresAt <= now) {
    throw expired('not-found');
  }
  const { host, loopback } = redirectHostOf(request.redirectUri);
  return {
    clientName: request.clientName,
    redirectHost: host,
    loopback,
    requestedScopes: request.requestedScopes,
    expiresAt: request.expiresAt,
  };
}

function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Allow or deny. Allow binds the signed-in uid and the chosen scopes to the request and returns the
 * client's redirect URI with a fresh single-use code; deny returns it with `error=access_denied`.
 * Both need a pending, unexpired request; the account is re-checked against `users/{uid}`.
 */
export async function authorizeRequest(
  store: McpStore,
  now: number,
  uid: string,
  input: McpAuthorizeRequest,
): Promise<McpAuthorizeResult> {
  const outcome = await store.runTransaction(async (tx) => {
    const request = await tx.getAuthRequest(input.requestId);
    if (!request || request.status !== 'pending' || request.expiresAt <= now) {
      throw expired('failed-precondition');
    }
    if (input.decision === 'deny') {
      tx.updateAuthRequest(input.requestId, { status: 'denied', uid });
      return {
        denied: true as const,
        clientId: request.clientId,
        redirectUrl: redirectWith(request.redirectUri, {
          error: 'access_denied',
          error_description: 'The user denied the request',
          state: request.state,
        }),
      };
    }
    const status = await tx.getAccountStatus(uid);
    if (status !== 'approved') {
      throw new HttpsError('permission-denied', "Your account can't do this.", {
        reason: 'account-not-approved',
        status: status ?? 'pending',
      });
    }
    const chosen = input.scopes ?? request.requestedScopes;
    const scopes: McpScope[] = request.requestedScopes.filter((scope) => chosen.includes(scope));
    if (scopes.length !== new Set(chosen).size || !scopes.includes(MCP_READ_SCOPE)) {
      throw new HttpsError('invalid-argument', 'Scopes must be a subset of the requested ones.', {
        reason: 'bad-scopes',
      });
    }
    const code = newAuthCode(input.requestId);
    tx.updateAuthRequest(input.requestId, {
      status: 'approved',
      uid,
      scopes,
      codeHash: hashSecret(code),
    });
    return {
      denied: false as const,
      clientId: request.clientId,
      redirectUrl: redirectWith(request.redirectUri, { code, state: request.state }),
    };
  });
  if (outcome.denied) {
    await writeMcpAudit(store, now, {
      kind: 'auth_denied',
      uid,
      clientId: outcome.clientId,
      error: 'user_denied',
    });
  }
  return { redirectUrl: outcome.redirectUrl };
}
