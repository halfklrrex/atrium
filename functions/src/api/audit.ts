import { logger } from 'firebase-functions/v2';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * The API audit log, `system/apiAudit/entries/{id}` (P8 section 6): an authentication failure, or one
 * entry per call with the route, the board, the outcome and the time it took. Kept 90 days (TTL on
 * `expiresAt`). Never the request body, a query string, an Authorization header, a token or an email.
 */
export const API_AUDIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface ApiAuditEntry {
  kind: 'call' | 'auth_failed';
  at: number;
  expiresAt: number;
  method: string;
  /** The route pattern (`/api/v1/boards/:id/items`), never the concrete path or query. */
  route?: string;
  boardId?: string;
  ok: boolean;
  status: number;
  /** A short code (`not_found`, `rate_limited`, `invalid_token`, ...). */
  error?: string;
  ms?: number;
  uid?: string;
  tokenId?: string;
}

export interface ApiAuditStore {
  append(entry: ApiAuditEntry): Promise<void>;
}

export function adminApiAuditStore(firestore: Firestore): ApiAuditStore {
  const entries = firestore.collection('system').doc('apiAudit').collection('entries');
  return {
    async append(entry) {
      await entries.add({
        ...entry,
        at: Timestamp.fromMillis(entry.at),
        expiresAt: Timestamp.fromMillis(entry.expiresAt),
      });
    },
  };
}

/** Best effort: a failed audit write is logged (ids only) and never fails the request. */
export async function writeApiAudit(
  store: ApiAuditStore,
  now: number,
  entry: Omit<ApiAuditEntry, 'at' | 'expiresAt'>,
): Promise<void> {
  try {
    await store.append({ ...entry, at: now, expiresAt: now + API_AUDIT_TTL_MS });
  } catch (error) {
    logger.error('Could not write the API audit entry', { kind: entry.kind, error });
  }
}
