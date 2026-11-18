import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { MCP_USAGE } from './oauth/constants';

/**
 * Usage limits of the hosted connector (OPS4 section 5). Two layers: a per-uid sliding window in
 * memory (60 calls a minute on each instance, so a runaway client is cut off cheaply) and a daily
 * counter per uid in `mcpUsage/{uid}` (2,000 calls, 500 of them writes). Raise the constants here.
 */
export const MCP_CALLS_PER_MINUTE = 60;
export const MCP_DAILY_CALLS = 2000;
export const MCP_DAILY_WRITES = 500;

const MINUTE_MS = 60 * 1000;

/** Sliding-window limiter, one window per key, kept in memory. */
export class MinuteLimiter {
  private readonly hits = new Map<string, number[]>();

  /** `windowMs` is a minute unless a caller (the API's per-IP failure limit) needs a longer window. */
  constructor(
    private readonly max: number = MCP_CALLS_PER_MINUTE,
    private readonly now: () => number = Date.now,
    private readonly windowMs: number = MINUTE_MS,
  ) {}

  /** True when `key` has used up its window; records nothing. */
  over(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    return recent.length >= this.max;
  }

  /** Records a call and returns true, or returns false (recording nothing) when over the limit. */
  take(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((at) => at <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}

export type UsageVerdict = 'ok' | 'calls' | 'writes';

/** The daily counters. `consume` counts the call only when it fits under both caps. */
export interface UsageStore {
  consume(uid: string, day: string, write: boolean): Promise<UsageVerdict>;
}

/** `YYYY-MM-DD` in UTC. */
export const usageDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

export function adminUsageStore(
  firestore: Firestore,
  caps: { calls: number; writes: number } = { calls: MCP_DAILY_CALLS, writes: MCP_DAILY_WRITES },
  /** The API reuses this store with its own collection and a TTL (`expiresAt`) on each counter. */
  options: { collection?: string; ttlMs?: number } = {},
): UsageStore {
  const collection = options.collection ?? MCP_USAGE;
  return {
    consume: (uid, day, write) =>
      firestore.runTransaction(async (tx) => {
        const ref = firestore.collection(collection).doc(uid);
        const snap = await tx.get(ref);
        const updatedAt = Timestamp.now();
        // Pushed out on every counted call, so a counter that is no longer used expires by TTL.
        const expiry =
          options.ttlMs === undefined
            ? {}
            : { expiresAt: Timestamp.fromMillis(updatedAt.toMillis() + options.ttlMs) };
        const sameDay = snap.exists && snap.get('day') === day;
        const calls = sameDay ? Number(snap.get('calls') ?? 0) : 0;
        const writes = sameDay ? Number(snap.get('writes') ?? 0) : 0;
        if (calls >= caps.calls) return 'calls' as const;
        if (write && writes >= caps.writes) return 'writes' as const;
        const add = write ? 1 : 0;
        if (sameDay) {
          tx.update(ref, {
            calls: FieldValue.increment(1),
            writes: FieldValue.increment(add),
            updatedAt,
            ...expiry,
          });
        } else {
          tx.set(ref, { day, calls: 1, writes: add, updatedAt, ...expiry });
        }
        return 'ok' as const;
      }),
  };
}
