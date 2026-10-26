import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { ZodType } from 'zod';
import type { Actor } from './membership';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Verified caller identity from the Auth token; throws `unauthenticated` when signed out. */
export function actorFromRequest(request: CallableRequest): Actor {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  const { uid, token } = request.auth;
  return {
    uid,
    email: str(token.email),
    emailVerified: token.email_verified === true,
    displayName: str(token.name),
    photoURL: str(token.picture),
  };
}

/** Parses callable input with a zod schema, mapping failures to `invalid-argument`. */
export function parseInput<Out>(schema: ZodType<Out>, data: unknown, name: string): Out {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', `Invalid ${name} request.`, parsed.error.issues);
  }
  return parsed.data;
}
