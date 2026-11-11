import type { AccountStatus } from '@atrium/shared';
import { MCP_ACCOUNT_CACHE_MAX, MCP_ACCOUNT_CACHE_TTL_MS } from './constants';

/**
 * Per-instance cache of `users/{uid}.accountStatus` for `verifyAccessToken` (OPS4 section 4.4): a
 * block takes at most 60 s to bite on a warm instance, and the cache never holds more than 500
 * accounts (the oldest entry goes first).
 */
export class AccountStatusCache {
  private readonly entries = new Map<string, { status: AccountStatus | null; at: number }>();

  constructor(
    private readonly load: (uid: string) => Promise<AccountStatus | null>,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = MCP_ACCOUNT_CACHE_TTL_MS,
    private readonly max = MCP_ACCOUNT_CACHE_MAX,
  ) {}

  async get(uid: string): Promise<AccountStatus | null> {
    const now = this.now();
    const hit = this.entries.get(uid);
    if (hit && now - hit.at < this.ttlMs) return hit.status;
    const status = await this.load(uid);
    this.entries.delete(uid);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(uid, { status, at: now });
    return status;
  }

  /** Forgets one account, so a change made by this instance is seen at once. */
  invalidate(uid: string): void {
    this.entries.delete(uid);
  }

  get size(): number {
    return this.entries.size;
  }
}
