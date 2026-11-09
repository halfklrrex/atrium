import { INBOX_LIMITS } from '@atrium/shared';
import { deleteThread, type InboxAuth, type InboxStore } from './inbox';

/**
 * The Inbox half of the daily purge (ADMIN-4 PR7): closed threads after 365 days, and stale
 * `inboxLimits` documents. Pure logic behind a narrow store and an injected clock, so it is unit
 * tested without an emulator. Logs carry counts and thread ids only, never text or emails.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A closed thread is deleted once it has been closed for more than this many days. */
export const INBOX_CLOSED_RETENTION_DAYS = 365;
/** Threads deleted per run; the rest wait for the next daily run. */
export const INBOX_PURGE_MAX_THREADS = 200;
/** An `inboxLimits` document is deleted once it has not been written for more than this. */
export const INBOX_LIMITS_RETENTION_DAYS = 30;
const LIMITS_PAGE_SIZE = 400;
const LIMITS_MAX_PAGES = 25;

export interface InboxPurgeStore {
  /** Ids of threads with `status == 'closed'` and `closedAt < cutoff`; at most `limit`. */
  listClosedThreadIdsBefore(cutoff: Date, limit: number): Promise<string[]>;
  /** `inboxLimits` documents with `updatedAt < cutoff`; at most `limit`. */
  listLimitsUpdatedBefore(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ uid: string; appealRefusedAt: Date | null }>>;
  deleteLimits(uids: ReadonlyArray<string>): Promise<void>;
}

export interface InboxPurgeLogger {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface InboxPurgeDeps {
  purgeStore: InboxPurgeStore;
  store: InboxStore;
  auth: InboxAuth;
  now: () => Date;
  logger: InboxPurgeLogger;
}

/** Step 1: deletes closed threads older than the retention window, at most 200 per run. */
export async function purgeClosedThreads(deps: InboxPurgeDeps): Promise<string[]> {
  const cutoff = new Date(deps.now().getTime() - INBOX_CLOSED_RETENTION_DAYS * DAY_MS);
  const ids = await deps.purgeStore.listClosedThreadIdsBefore(cutoff, INBOX_PURGE_MAX_THREADS);
  const deleted: string[] = [];
  // One Auth listing for the whole run (it pages through every user), not one per thread.
  const adminUids = ids.length > 0 ? await deps.auth.listAdminUids() : [];
  for (const id of ids.slice(0, INBOX_PURGE_MAX_THREADS)) {
    await deleteThread(deps, id, adminUids);
    deleted.push(id);
  }
  deps.logger.info(`Inbox purge: deleted ${deleted.length} closed threads.`, {
    count: deleted.length,
    threadIds: deleted,
  });
  return deleted;
}

/**
 * Step 2: deletes `inboxLimits` documents idle for more than 30 days, except those whose appeal
 * wait is still running (`appealRefusedAt` less than 7 days ago): deleting one would end the wait early.
 */
export async function purgeStaleLimits(deps: InboxPurgeDeps): Promise<number> {
  const nowMs = deps.now().getTime();
  const cutoff = new Date(nowMs - INBOX_LIMITS_RETENTION_DAYS * DAY_MS);
  const waitStart = nowMs - INBOX_LIMITS.appealWaitDays * DAY_MS;
  let deleted = 0;
  for (let page = 0; page < LIMITS_MAX_PAGES; page += 1) {
    const docs = await deps.purgeStore.listLimitsUpdatedBefore(cutoff, LIMITS_PAGE_SIZE);
    const uids = docs
      .filter((d) => d.appealRefusedAt === null || d.appealRefusedAt.getTime() <= waitStart)
      .map((d) => d.uid);
    if (uids.length > 0) await deps.purgeStore.deleteLimits(uids);
    deleted += uids.length;
    // Protected documents stay and would come back on the next page; stop unless progress was made.
    if (docs.length < LIMITS_PAGE_SIZE || uids.length === 0) break;
  }
  deps.logger.info(`Inbox purge: deleted ${deleted} stale limit documents.`, { count: deleted });
  return deleted;
}

/** Runs both steps; a failure in one is logged and never skips the other. */
export async function purgeInbox(deps: InboxPurgeDeps): Promise<{ failed: boolean }> {
  let failed = false;
  for (const [name, step] of [
    ['closed threads', purgeClosedThreads],
    ['stale limits', purgeStaleLimits],
  ] as const) {
    try {
      await step(deps);
    } catch (error) {
      failed = true;
      deps.logger.error(`Inbox purge step failed: ${name}.`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { failed };
}
