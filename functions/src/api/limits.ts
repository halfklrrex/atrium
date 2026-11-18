import type { Firestore } from 'firebase-admin/firestore';
import { INCOMING_HOOK_DAILY_CALLS } from '@atrium/shared';
import { adminUsageStore, type UsageStore } from '../mcp/limits';

/**
 * Usage limits of the public API (P8 section 6). Same machinery as the hosted connector (OPS4): a
 * sliding window in memory per token on each instance, a daily counter per token in
 * `apiUsage/{tokenId or uid}`, and a per-IP window for failed sign-ins. Every constant lives here.
 */
export const API_CALLS_PER_MINUTE = 120;
export const API_DAILY_CALLS = 5000;
export const API_DAILY_WRITES = 1000;
/** Failed authentications per client IP and hour, per instance. */
export const API_FAILED_AUTH_PER_HOUR = 300;
export const API_FAILED_AUTH_WINDOW_MS = 60 * 60 * 1000;
/** Retry-After of the per-minute window: the window itself, in seconds. */
export const API_MINUTE_RETRY_SECONDS = 60;

export const API_USAGE = 'apiUsage';
/** A counter that is no longer used expires (TTL on `expiresAt`, pushed out on each counted call). */
export const API_USAGE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** `apiUsage/{tokenId or uid}` with the API's caps and a TTL. */
export const adminApiUsageStore = (firestore: Firestore): UsageStore =>
  adminUsageStore(
    firestore,
    { calls: API_DAILY_CALLS, writes: API_DAILY_WRITES },
    { collection: API_USAGE, ttlMs: API_USAGE_TTL_MS },
  );

/**
 * Incoming webhooks (P8 PR 7a): `apiUsage/hook_<hookId>` with 1,000 calls a day (every call is a write)
 * and the same TTL, so no new collection or rule is needed.
 */
export const adminHookUsageStore = (firestore: Firestore): UsageStore =>
  adminUsageStore(
    firestore,
    { calls: INCOMING_HOOK_DAILY_CALLS, writes: INCOMING_HOOK_DAILY_CALLS },
    { collection: API_USAGE, ttlMs: API_USAGE_TTL_MS },
  );

/** Seconds until the next UTC midnight (when the daily counters reset), at least 1. */
export function secondsUntilNextUtcDay(now: number): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}
