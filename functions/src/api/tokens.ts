import { createHash, randomBytes } from 'node:crypto';
import {
  API_TOKEN_DISPLAY_PREFIX_LENGTH,
  API_TOKEN_MAX_ACTIVE,
  API_TOKEN_PREFIX,
  type CreateApiTokenRequest,
  type CreateApiTokenResult,
  type RevokeApiTokenRequest,
  type RevokeApiTokenResult,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ApiTokenStore } from './token-store';

/**
 * Personal access token logic (P8 section 3): create and revoke. Only the SHA-256 hash of a token is
 * stored (in `apiTokenIndex`); the token itself is returned once and never logged.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh token: `atrp_` + 32 random bytes, base64url. Never log it. */
export const newApiToken = (): string => `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;

/** SHA-256 hex of a token: the document id in `apiTokenIndex`. */
export const hashApiToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** The first characters of a token, kept for display only. */
export const tokenDisplayPrefix = (token: string): string =>
  token.slice(0, API_TOKEN_DISPLAY_PREFIX_LENGTH);

export async function createApiToken(
  store: ApiTokenStore,
  now: number,
  uid: string,
  input: CreateApiTokenRequest,
): Promise<CreateApiTokenResult> {
  const workspaceIds = input.workspaceIds?.length ? [...new Set(input.workspaceIds)] : null;
  if (workspaceIds) {
    for (const workspaceId of workspaceIds) {
      if (!(await store.isWorkspaceMember(uid, workspaceId))) {
        throw new HttpsError('permission-denied', 'You are not a member of that workspace.');
      }
    }
  }
  const token = newApiToken();
  const tokenId = store.newId();
  const expiresAt = now + input.expiresInDays * DAY_MS;
  const prefix = tokenDisplayPrefix(token);
  const created = await store.createTokenIfRoom({
    uid,
    tokenId,
    doc: {
      name: input.name,
      prefix,
      scopes: [...input.scopes],
      workspaceIds,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    },
    hash: hashApiToken(token),
    index: { uid, tokenId, expiresAt },
    now,
    maxActive: API_TOKEN_MAX_ACTIVE,
  });
  if (!created) {
    throw new HttpsError(
      'resource-exhausted',
      `You can have at most ${API_TOKEN_MAX_ACTIVE} active tokens. Revoke one first.`,
    );
  }
  return { tokenId, token, prefix, expiresAt };
}

export async function revokeApiToken(
  store: ApiTokenStore,
  now: number,
  uid: string,
  input: RevokeApiTokenRequest,
): Promise<RevokeApiTokenResult> {
  const doc = await store.getToken(uid, input.tokenId);
  if (!doc) throw new HttpsError('not-found', 'No such token.');
  if (doc.revokedAt !== null) return { tokenId: input.tokenId, revoked: false };
  await store.revokeToken(uid, input.tokenId, now);
  return { tokenId: input.tokenId, revoked: true };
}

/** Every unrevoked token of one account (admin block). Returns how many were revoked. */
export async function revokeAllApiTokens(
  store: ApiTokenStore,
  now: number,
  uid: string,
): Promise<number> {
  const tokens = await store.listUnrevokedTokens(uid);
  for (const ref of tokens) await store.revokeToken(uid, ref.tokenId, now);
  return tokens.length;
}
