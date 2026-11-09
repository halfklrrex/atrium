import { describe, expect, it } from 'vitest';
import type { InboxAuth, InboxStore, ThreadData } from './inbox';
import {
  INBOX_PURGE_MAX_THREADS,
  purgeClosedThreads,
  purgeInbox,
  purgeStaleLimits,
  type InboxPurgeDeps,
  type InboxPurgeStore,
} from './inbox-purge';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-01T04:00:00Z');
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY - extraMs);

interface Thr {
  status: 'open' | 'answered' | 'closed';
  closedAt: Date | null;
}
interface Lim {
  updatedAt: Date;
  appealRefusedAt: Date | null;
}

/** One in-memory backend that answers both the purge queries and the `deleteThread` calls. */
class Fake {
  threads = new Map<string, Thr>();
  limits = new Map<string, Lim>();
  failThreadQuery = false;
  failLimitQuery = false;
  logs: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];

  purgeStore: InboxPurgeStore = {
    listClosedThreadIdsBefore: async (cutoff, limit) => {
      if (this.failThreadQuery) throw new Error('boom');
      return [...this.threads.entries()]
        .filter(([, t]) => t.status === 'closed' && t.closedAt && t.closedAt < cutoff)
        .sort((a, b) => a[1].closedAt!.getTime() - b[1].closedAt!.getTime())
        .slice(0, limit)
        .map(([id]) => id);
    },
    listLimitsUpdatedBefore: async (cutoff, limit) => {
      if (this.failLimitQuery) throw new Error('boom');
      return [...this.limits.entries()]
        .filter(([, l]) => l.updatedAt < cutoff)
        .slice(0, limit)
        .map(([uid, l]) => ({ uid, appealRefusedAt: l.appealRefusedAt }));
    },
    deleteLimits: async (uids) => {
      for (const uid of uids) this.limits.delete(uid);
    },
  };

  store = {
    getThread: async (id: string) =>
      this.threads.has(id) ? ({ senderUid: 'u1' } as unknown as ThreadData) : null,
    deleteNotifications: async () => {},
    getNotifiedUids: async () => [],
    deleteMessagesBatch: async () => 0,
    deleteAuditBatch: async () => 0,
    deleteNoteAndThread: async (id: string) => void this.threads.delete(id),
  } as unknown as InboxStore;

  auth: InboxAuth = {
    listAdminUids: async () => ['adm1'],
    getAccountStatus: async () => null,
  };

  deps(): InboxPurgeDeps {
    return {
      purgeStore: this.purgeStore,
      store: this.store,
      auth: this.auth,
      now: () => NOW,
      logger: {
        info: (message, data) => void this.logs.push({ level: 'info', message, data }),
        error: (message, data) => void this.logs.push({ level: 'error', message, data }),
      },
    };
  }
}

const closed = (closedAt: Date): Thr => ({ status: 'closed', closedAt });

describe('purgeClosedThreads', () => {
  it('deletes only closed threads strictly older than 365 days', async () => {
    const f = new Fake();
    f.threads.set('exact', closed(ago(365)));
    f.threads.set('younger', closed(ago(364)));
    f.threads.set('older', closed(ago(366)));
    f.threads.set('justOlder', closed(ago(365, 1)));
    expect((await purgeClosedThreads(f.deps())).sort()).toEqual(['justOlder', 'older']);
    expect([...f.threads.keys()].sort()).toEqual(['exact', 'younger']);
  });

  it('never deletes open or answered threads, however old', async () => {
    const f = new Fake();
    f.threads.set('o', { status: 'open', closedAt: null });
    f.threads.set('a', { status: 'answered', closedAt: null });
    f.threads.set('stale', { status: 'answered', closedAt: ago(900) });
    expect(await purgeClosedThreads(f.deps())).toEqual([]);
    expect(f.threads.size).toBe(3);
  });

  it('deletes at most 200 per run and leaves the rest for the next run', async () => {
    const f = new Fake();
    for (let i = 0; i < 230; i += 1) f.threads.set(`t${i}`, closed(ago(400, i)));
    expect(await purgeClosedThreads(f.deps())).toHaveLength(INBOX_PURGE_MAX_THREADS);
    expect(f.threads.size).toBe(30);
    expect(await purgeClosedThreads(f.deps())).toHaveLength(30);
    expect(f.threads.size).toBe(0);
  });

  it('is idempotent', async () => {
    const f = new Fake();
    f.threads.set('old', closed(ago(500)));
    await purgeClosedThreads(f.deps());
    expect(await purgeClosedThreads(f.deps())).toEqual([]);
  });

  it('logs the count and thread ids only', async () => {
    const f = new Fake();
    f.threads.set('old', closed(ago(500)));
    await purgeClosedThreads(f.deps());
    expect(f.logs).toHaveLength(1);
    expect(f.logs[0]!.data).toEqual({ count: 1, threadIds: ['old'] });
  });
});

describe('purgeStaleLimits', () => {
  it('deletes limits idle for more than 30 days (30 exactly stays)', async () => {
    const f = new Fake();
    f.limits.set('exact', { updatedAt: ago(30), appealRefusedAt: null });
    f.limits.set('younger', { updatedAt: ago(29), appealRefusedAt: null });
    f.limits.set('older', { updatedAt: ago(31), appealRefusedAt: null });
    expect(await purgeStaleLimits(f.deps())).toBe(1);
    expect([...f.limits.keys()].sort()).toEqual(['exact', 'younger']);
  });

  it('keeps a limit whose appeal wait is still running (refused 6 days ago)', async () => {
    const f = new Fake();
    f.limits.set('waiting', { updatedAt: ago(40), appealRefusedAt: ago(6) });
    f.limits.set('done', { updatedAt: ago(40), appealRefusedAt: ago(8) });
    f.limits.set('boundary', { updatedAt: ago(40), appealRefusedAt: ago(7) });
    expect(await purgeStaleLimits(f.deps())).toBe(2);
    expect([...f.limits.keys()]).toEqual(['waiting']);
  });

  it('is idempotent and stops when only protected documents are left', async () => {
    const f = new Fake();
    f.limits.set('waiting', { updatedAt: ago(40), appealRefusedAt: ago(1) });
    expect(await purgeStaleLimits(f.deps())).toBe(0);
    expect(await purgeStaleLimits(f.deps())).toBe(0);
    expect(f.limits.size).toBe(1);
  });
});

describe('purgeInbox', () => {
  it('a failing thread step does not skip the limits step', async () => {
    const f = new Fake();
    f.failThreadQuery = true;
    f.limits.set('old', { updatedAt: ago(60), appealRefusedAt: null });
    expect(await purgeInbox(f.deps())).toEqual({ failed: true });
    expect(f.limits.size).toBe(0);
    expect(f.logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('a failing limits step does not undo the thread step', async () => {
    const f = new Fake();
    f.failLimitQuery = true;
    f.threads.set('old', closed(ago(500)));
    expect(await purgeInbox(f.deps())).toEqual({ failed: true });
    expect(f.threads.size).toBe(0);
  });

  it('reports success when both steps work', async () => {
    const f = new Fake();
    expect(await purgeInbox(f.deps())).toEqual({ failed: false });
  });
});
