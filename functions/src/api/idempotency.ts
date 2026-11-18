import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * `Idempotency-Key` for `POST` (P8 section 4). The first successful response (status and body) is kept in
 * `apiIdempotency/{uid}_{key}` for 24 hours (TTL on `expiresAt`); a repeat with the same key and the same
 * request (method, path, query and body hash) gets it back with `Idempotency-Replayed: true`. While the
 * first request runs, the record is a `pending` marker with a short lease, so a concurrent twin is turned
 * away with 409. Errors are never stored: the marker is deleted and the client may retry.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A little over the function timeout (55 s): a crashed request's marker frees itself after this. */
export const IDEMPOTENCY_LEASE_MS = 60_000;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const IDEMPOTENCY_COLLECTION = 'apiIdempotency';

export const IDEMPOTENCY_MISMATCH_MESSAGE =
  'This Idempotency-Key was used with a different request.';
export const IDEMPOTENCY_RUNNING_MESSAGE = 'A request with this Idempotency-Key is still running.';

export interface IdempotencyRecord {
  hash: string;
  state: 'pending' | 'done';
  /** Pending only: when the marker stops counting as running (epoch ms). */
  leaseUntil: number;
  /** Done only. */
  status?: number;
  /** Done only: the response body as JSON text. */
  body?: string;
  expiresAt: number;
}

export type IdempotencyBegin =
  | { kind: 'run' }
  | { kind: 'replay'; status: number; body: string }
  | { kind: 'mismatch' }
  | { kind: 'running' };

export interface IdempotencyStore {
  /** Atomically: create the pending marker, or say what the existing record means. */
  begin(id: string, hash: string, now: number): Promise<IdempotencyBegin>;
  complete(id: string, hash: string, status: number, body: string, now: number): Promise<void>;
  /** Deletes a pending marker (the request failed), so the key can be used again. */
  release(id: string): Promise<void>;
}

/** The decision shared by the Firestore adapter and the in-memory fake. */
export function decideBegin(
  existing: IdempotencyRecord | undefined,
  hash: string,
  now: number,
): { next: IdempotencyRecord | null; result: IdempotencyBegin } {
  const fresh: IdempotencyRecord = {
    hash,
    state: 'pending',
    leaseUntil: now + IDEMPOTENCY_LEASE_MS,
    expiresAt: now + IDEMPOTENCY_TTL_MS,
  };
  if (!existing || existing.expiresAt <= now) return { next: fresh, result: { kind: 'run' } };
  if (existing.hash !== hash) return { next: null, result: { kind: 'mismatch' } };
  if (existing.state === 'done') {
    return {
      next: null,
      result: { kind: 'replay', status: existing.status ?? 200, body: existing.body ?? 'null' },
    };
  }
  if (existing.leaseUntil <= now) return { next: fresh, result: { kind: 'run' } };
  return { next: null, result: { kind: 'running' } };
}

export const idempotencyId = (uid: string, key: string): string => `${uid}_${key}`;

/** JSON with sorted keys, so the same body hashes the same whatever its key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requestHash(method: string, path: string, query: unknown, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${path}\n${canonicalJson(query)}\n${canonicalJson(body)}`)
    .digest('hex');
}

const toDoc = (r: IdempotencyRecord): Record<string, unknown> => ({
  hash: r.hash,
  state: r.state,
  leaseUntil: Timestamp.fromMillis(r.leaseUntil),
  expiresAt: Timestamp.fromMillis(r.expiresAt),
  ...(r.status !== undefined ? { status: r.status } : {}),
  ...(r.body !== undefined ? { body: r.body } : {}),
});

export function adminIdempotencyStore(firestore: Firestore): IdempotencyStore {
  const col = firestore.collection(IDEMPOTENCY_COLLECTION);
  return {
    async begin(id, hash, now) {
      const ref = col.doc(id);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        const existing: IdempotencyRecord | undefined = data
          ? {
              hash: String(data.hash),
              state: data.state === 'done' ? 'done' : 'pending',
              leaseUntil: data.leaseUntil instanceof Timestamp ? data.leaseUntil.toMillis() : 0,
              expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0,
              ...(typeof data.status === 'number' ? { status: data.status } : {}),
              ...(typeof data.body === 'string' ? { body: data.body } : {}),
            }
          : undefined;
        const { next, result } = decideBegin(existing, hash, now);
        if (next) tx.set(ref, toDoc(next));
        return result;
      });
    },
    async complete(id, hash, status, body, now) {
      await col.doc(id).set(
        toDoc({
          hash,
          state: 'done',
          leaseUntil: now,
          status,
          body,
          expiresAt: now + IDEMPOTENCY_TTL_MS,
        }),
      );
    },
    async release(id) {
      await col.doc(id).delete();
    },
  };
}

/** In-memory store for tests (same decisions; one JS thread makes `begin` atomic). */
export class FakeIdempotencyStore implements IdempotencyStore {
  readonly records = new Map<string, IdempotencyRecord>();
  async begin(id: string, hash: string, now: number): Promise<IdempotencyBegin> {
    const { next, result } = decideBegin(this.records.get(id), hash, now);
    if (next) this.records.set(id, next);
    return result;
  }
  async complete(
    id: string,
    hash: string,
    status: number,
    body: string,
    now: number,
  ): Promise<void> {
    this.records.set(id, {
      hash,
      state: 'done',
      leaseUntil: now,
      status,
      body,
      expiresAt: now + IDEMPOTENCY_TTL_MS,
    });
  }
  async release(id: string): Promise<void> {
    this.records.delete(id);
  }
}
