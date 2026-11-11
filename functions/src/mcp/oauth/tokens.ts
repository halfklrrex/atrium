import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque credentials (OPS4 section 4.2): tokens are 32 random bytes, base64url, prefixed `atr_`;
 * authorization codes are `<requestId>.<32 random bytes base64url>`. Only SHA-256 hashes are ever
 * stored, and nothing in this module logs.
 */

export const TOKEN_PREFIX = 'atr_';

const randomPart = (): string => randomBytes(32).toString('base64url');

/** A fresh access or refresh token. Never log it. */
export const newToken = (): string => `${TOKEN_PREFIX}${randomPart()}`;

/** SHA-256 hex of a token or code: the document id in `mcpTokens`, the `codeHash` of a request. */
export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret, 'utf8').digest('hex');

/** A fresh authorization code for a request. Never log it. */
export const newAuthCode = (requestId: string): string => `${requestId}.${randomPart()}`;

/** The request id in front of the first dot, or null for anything that is not shaped like a code. */
export function authCodeRequestId(code: string): string | null {
  const dot = code.indexOf('.');
  if (dot <= 0 || dot === code.length - 1) return null;
  const requestId = code.slice(0, dot);
  return /^[A-Za-z0-9_-]{1,128}$/.test(requestId) ? requestId : null;
}

/** Constant-time comparison of a presented secret with a stored hash. */
export function secretMatchesHash(secret: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
