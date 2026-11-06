import { computeNextRunAt, dateRunId, recurringRunId, type BoardRole } from '@atrium/shared';
import type { WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import type { NewActivity } from '../activity';
import type { BoardData, ItemData } from '../column-actions';
import type { NewNotification, NotificationStore } from '../notifications';
import { CIRCUIT_BREAKER_FAILURES, MAX_RUNS_PER_HOUR, hourBucketOf } from './limits';
import {
  CATCH_UP_CAP_MS,
  latestOccurrence,
  localMinutesInZone,
  runTick,
  type DateItem,
  type SchedulerStore,
  type TickDeps,
} from './schedule';
import type { AutomationDoc, AutomationRunTx, AutomationStore, RunRecord } from './run';

const MADRID = 'Europe/Madrid';
const HOUR = 3_600_000;

interface StoredItem extends Omit<DateItem, 'id'> {
  state: 'active' | 'archived' | 'deleted';
}

interface World {
  board: BoardData;
  roles: Record<string, WorkspaceRole>;
  automations: Map<string, AutomationDoc & { boardId: string }>;
  items: Map<string, StoredItem>;
  runs: Map<string, RunRecord>;
  counter: { hourBucket: string; runs: number } | null;
  createdItems: Array<Record<string, unknown>>;
  itemPatches: Array<Record<string, unknown>>;
  activities: NewActivity[];
  notifications: Array<{ uid: string; id: string; data: NewNotification }>;
  lastTickMs: number | null;
  /** Throws from the next transaction (a transient error). */
  failNextTransaction: boolean;
}

const recurring = (
  over: Partial<AutomationDoc> = {},
  trigger: Partial<Extract<AutomationDoc['trigger'], { type: 'recurring' }>> = {},
): AutomationDoc & { boardId: string } => ({
  id: 'r1',
  boardId: 'b1',
  name: 'Weekly review',
  enabled: true,
  trigger: { type: 'recurring', every: 'day', at: '09:00', ...trigger },
  conditions: [],
  actions: [{ type: 'create_item', name: 'Review {date}' }],
  runAs: 'creator',
  disabledReason: null,
  consecutiveFailures: 0,
  timezone: MADRID,
  nextRunAtMs: null,
  ...over,
});

const dateArrives = (
  over: Partial<AutomationDoc> = {},
  trigger: Partial<Extract<AutomationDoc['trigger'], { type: 'date_arrives' }>> = {},
): AutomationDoc & { boardId: string } => ({
  id: 'd1',
  boardId: 'b1',
  name: 'Due soon',
  enabled: true,
  trigger: { type: 'date_arrives', columnId: 'due', offsetDays: 0, at: '09:00', ...trigger },
  conditions: [],
  actions: [{ type: 'notify', uids: ['pal'], message: 'Due' }],
  runAs: 'creator',
  disabledReason: null,
  consecutiveFailures: 0,
  timezone: MADRID,
  ...over,
});

function makeWorld(over: Partial<World> = {}): World {
  return {
    board: {
      kind: 'main',
      workspaceId: 'ws',
      access: { creator: 'owner' as BoardRole },
      columns: [
        { id: 'due', type: 'date', title: 'Due', settings: {} },
        { id: 'stage', type: 'text', title: 'Stage', settings: {} },
      ],
      groups: [{ id: 'g1' }],
      memberUids: ['creator', 'pal'],
    },
    roles: { creator: 'member', pal: 'member' },
    automations: new Map(),
    items: new Map(),
    runs: new Map(),
    counter: null,
    createdItems: [],
    itemPatches: [],
    activities: [],
    notifications: [],
    lastTickMs: null,
    failNextTransaction: false,
    ...over,
  };
}

const queues = new WeakMap<World, Promise<unknown>>();
const add = (w: World, a: AutomationDoc & { boardId: string }) => void w.automations.set(a.id, a);

/** The Admin adapter's job for `nextRunAt`: epoch ms in, stored as ms. */
function makeAutomationStore(w: World, nowMs: () => number): AutomationStore {
  // Firestore transactions on one document serialise (the loser retries on fresh data).
  return {
    transact(fn) {
      const run = async () => {
        if (w.failNextTransaction) {
          w.failNextTransaction = false;
          throw new Error('UNAVAILABLE');
        }
        const pending: Array<() => void> = [];
        const tx: AutomationRunTx = {
          async getBoard() {
            return w.board;
          },
          async getWorkspaceMemberRole(_ws, uid) {
            return w.roles[uid] ?? null;
          },
          async getItem(_b, id) {
            const item = w.items.get(id);
            return item
              ? ({ id, name: item.name, state: item.state, values: item.values } as ItemData)
              : null;
          },
          updateItemValues() {
            throw new Error('unused');
          },
          updateItem(_b, _i, patch) {
            pending.push(() => w.itemPatches.push(patch));
          },
          async getLastItemPosition() {
            return 'a1';
          },
          createItem(_b, item) {
            pending.push(() => w.createdItems.push(item as unknown as Record<string, unknown>));
            return 'new1';
          },
          createUpdate() {
            throw new Error('unused');
          },
          async hasRecentButtonClick() {
            return false;
          },
          async getMemberProfile() {
            return null;
          },
          async appendActivity(_b, activity) {
            pending.push(() => w.activities.push(activity));
            return 'act1';
          },
          nowMs,
          newSessionId: () => 's',
          async getAutomation(_b, id) {
            const a = w.automations.get(id);
            return a ? structuredClone(a) : null;
          },
          async runExists(_b, runId) {
            return w.runs.has(runId);
          },
          async getCounter() {
            return w.counter ? { ...w.counter } : null;
          },
          setCounter(_b, counter) {
            pending.push(() => (w.counter = counter));
          },
          createRun(_b, runId, run) {
            pending.push(() => w.runs.set(runId, run));
          },
          updateAutomation(_b, id, fields) {
            pending.push(() => {
              const a = w.automations.get(id);
              if (!a) return;
              const { nextRunAt, ...rest } = fields;
              w.automations.set(id, {
                ...a,
                ...rest,
                ...(nextRunAt !== undefined ? { nextRunAtMs: nextRunAt as number | null } : {}),
              } as AutomationDoc & { boardId: string });
            });
          },
        };
        const result = await fn(tx);
        pending.forEach((apply) => apply());
        return result;
      };
      const queue = queues.get(w) ?? Promise.resolve();
      const next = queue.then(run, run);
      queues.set(
        w,
        next.catch(() => undefined),
      );
      return next as ReturnType<typeof fn>;
    },
    async listEnabledAutomations() {
      return [];
    },
    async getColumns() {
      return w.board.columns;
    },
    async listPendingDeliveries() {
      return [];
    },
    async markDelivered(_b, runId) {
      const r = w.runs.get(runId);
      if (r) w.runs.set(runId, { ...r, delivered: true });
    },
  };
}

function makeSchedulerStore(w: World): SchedulerStore & { barrier?: () => Promise<void> } {
  const store: SchedulerStore & { barrier?: () => Promise<void> } = {
    async getLastTickMs() {
      return w.lastTickMs;
    },
    async setLastTickMs(ms) {
      w.lastTickMs = ms;
    },
    async listDueRecurring(nowMs) {
      const due = [...w.automations.values()].filter(
        (a) =>
          a.enabled &&
          a.trigger.type === 'recurring' &&
          a.nextRunAtMs != null &&
          a.nextRunAtMs <= nowMs,
      );
      const snapshot = structuredClone(due).map((a) => ({ boardId: a.boardId, automation: a }));
      await store.barrier?.();
      return snapshot;
    },
    async listDateArrivesRecipes() {
      return [...w.automations.values()]
        .filter((a) => a.enabled && a.trigger.type === 'date_arrives')
        .map((a) => ({ boardId: a.boardId, automation: structuredClone(a) }));
    },
    async listItemsByDateKey(_boardId, dateKey) {
      const [col, date] = dateKey.split(':') as [string, string];
      return [...w.items.entries()]
        .filter(
          ([, item]) =>
            item.state === 'active' && (item.values[col] as { date?: string })?.date === date,
        )
        .map(([id, item]) => ({ id, name: item.name, values: item.values }));
    },
  };
  return store;
}

function makeNotifications(w: World): NotificationStore {
  return {
    async getBoard() {
      return {
        name: 'Board',
        kind: 'main',
        workspaceId: 'ws',
        access: w.board.access,
        columns: [],
        subitemColumns: [],
      };
    },
    async getWorkspaceRoles() {
      return w.roles;
    },
    async getPrefs() {
      return undefined;
    },
    async getMemberProfile() {
      return { name: 'Casey Lane', photoURL: null };
    },
    async getItemName() {
      return 'Task';
    },
    async getUpdateAuthorId() {
      return null;
    },
    async createNotification(uid, id, data) {
      if (w.notifications.some((n) => n.id === id && n.uid === uid)) return false;
      w.notifications.push({ uid, id, data });
      return true;
    },
  };
}

function deps(w: World, nowMs: number, store = makeSchedulerStore(w)): TickDeps {
  return {
    store,
    automations: makeAutomationStore(w, () => nowMs),
    notifications: makeNotifications(w),
    serverTimestamp: 'ts',
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('localMinutesInZone', () => {
  it('reads the wall clock of the zone, daylight saving included', () => {
    expect(localMinutesInZone(Date.UTC(2026, 6, 1, 7, 30), MADRID)).toBe(9 * 60 + 30);
    expect(localMinutesInZone(Date.UTC(2026, 11, 1, 7, 30), MADRID)).toBe(8 * 60 + 30);
  });
});

describe('recurring recipes', () => {
  // Madrid in November is UTC+1, so 09:00 local is 08:00Z.
  const OCC = Date.UTC(2026, 10, 4, 8, 0);

  it('two overlapping ticks run a recipe once', async () => {
    const w = makeWorld();
    add(w, recurring({ nextRunAtMs: OCC }));
    const now = OCC + 2 * 60_000;
    let waiting = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const mk = () => {
      const store = makeSchedulerStore(w);
      store.barrier = async () => {
        waiting += 1;
        if (waiting === 2) release();
        await gate;
      };
      return deps(w, now, store);
    };
    const [a, b] = await Promise.all([runTick(mk(), now), runTick(mk(), now)]);
    expect(w.createdItems).toHaveLength(1);
    expect([...w.runs.keys()]).toEqual([recurringRunId('r1', iso(OCC))]);
    expect(a.outcomes.ok + b.outcomes.ok).toBe(1);
    expect(a.outcomes.none + b.outcomes.none).toBe(1);
    expect(w.automations.get('r1')?.nextRunAtMs).toBe(OCC + 24 * HOUR);
  });

  it('records no item and no item patch for a recurring notify', async () => {
    const w = makeWorld();
    add(
      w,
      recurring({ nextRunAtMs: OCC, actions: [{ type: 'notify', uids: ['pal'], message: 'Hi' }] }),
    );
    await runTick(deps(w, OCC + 1000), OCC + 1000);
    expect(w.itemPatches).toHaveLength(0);
    expect(w.notifications).toHaveLength(1);
    expect(w.notifications[0]?.data.itemId).toBe('b1');
    expect(w.runs.get(recurringRunId('r1', iso(OCC)))).toMatchObject({
      status: 'ok',
      itemId: null,
      depth: 0,
    });
  });

  it('a 3 hour outage runs the recipe once, then waits for tomorrow', async () => {
    const w = makeWorld();
    add(w, recurring({ nextRunAtMs: OCC }));
    const now = OCC + 3 * HOUR;
    const first = await runTick(deps(w, now), now);
    expect(first.recurringRuns).toBe(1);
    expect(w.createdItems).toHaveLength(1);
    const again = await runTick(deps(w, now + 5 * 60_000), now + 5 * 60_000);
    expect(again.recurringRuns).toBe(0);
    expect(w.createdItems).toHaveLength(1);
  });

  it('a 30 hour outage of a daily recipe runs once, for the occurrence inside the 24 hours', async () => {
    const w = makeWorld();
    add(w, recurring({ nextRunAtMs: OCC }));
    const now = OCC + 30 * HOUR;
    await runTick(deps(w, now), now);
    expect(w.createdItems).toHaveLength(1);
    // The occurrence 30 hours ago is not replayed; the one 6 hours ago is.
    expect([...w.runs.keys()]).toEqual([recurringRunId('r1', iso(OCC + 24 * HOUR))]);
    expect(w.automations.get('r1')?.nextRunAtMs).toBe(OCC + 48 * HOUR);
  });

  it('an occurrence older than the cap is only recorded as skipped, and the schedule moves on', async () => {
    const w = makeWorld();
    // Wednesday 2026-11-04 09:00 Madrid, weekly.
    add(w, recurring({ nextRunAtMs: OCC }, { every: 'week', weekday: 3 }));
    const now = OCC + 30 * HOUR;
    await runTick(deps(w, now), now);
    expect(w.createdItems).toHaveLength(0);
    expect(w.runs.get(recurringRunId('r1', iso(OCC)))).toMatchObject({
      status: 'skipped',
      reason: 'missed during an outage',
    });
    expect(w.automations.get('r1')?.nextRunAtMs).toBe(OCC + 7 * 24 * HOUR);
    expect(CATCH_UP_CAP_MS).toBe(24 * HOUR);
  });

  it('latestOccurrence picks the last missed one', () => {
    const a = recurring({ nextRunAtMs: OCC });
    expect(latestOccurrence(a, OCC + 3 * 24 * HOUR + HOUR)).toBe(OCC + 3 * 24 * HOUR);
    expect(latestOccurrence(a, OCC - 1)).toBe(OCC);
  });

  it('keeps 09:00 local across the autumn and spring clock changes', async () => {
    // Madrid leaves summer time on 2026-10-25: 09:00 is 07:00Z before and 08:00Z after.
    const w = makeWorld();
    const before = Date.UTC(2026, 9, 24, 7, 0);
    add(w, recurring({ nextRunAtMs: before }));
    await runTick(deps(w, before + 1000), before + 1000);
    expect(w.automations.get('r1')?.nextRunAtMs).toBe(Date.UTC(2026, 9, 25, 8, 0));
    // Spring: 2027-03-28, 09:00 is 08:00Z before and 07:00Z after.
    const w2 = makeWorld();
    const springBefore = Date.UTC(2027, 2, 27, 8, 0);
    add(w2, recurring({ nextRunAtMs: springBefore }));
    await runTick(deps(w2, springBefore + 1000), springBefore + 1000);
    expect(w2.automations.get('r1')?.nextRunAtMs).toBe(Date.UTC(2027, 2, 28, 7, 0));
  });

  it('a recipe at 02:30 on the spring-forward night still runs once that day', async () => {
    const w = makeWorld();
    const before = Date.UTC(2027, 2, 27, 1, 30); // 02:30 Madrid, UTC+1
    add(w, recurring({ nextRunAtMs: before }, { at: '02:30' }));
    await runTick(deps(w, before + 1000), before + 1000);
    const next = w.automations.get('r1')?.nextRunAtMs as number;
    expect(next).toBe(computeNextRunAt({ every: 'day', at: '02:30' }, MADRID, before + 1000));
    expect(next).toBeGreaterThan(before);
    expect(next - before).toBeLessThanOrEqual(25 * HOUR);
  });

  it('still obeys the hourly rate limit: the excess run is recorded skipped', async () => {
    const w = makeWorld();
    const now = OCC + 1000;
    w.counter = { hourBucket: hourBucketOf(now), runs: MAX_RUNS_PER_HOUR };
    add(w, recurring({ nextRunAtMs: OCC }));
    await runTick(deps(w, now), now);
    expect(w.createdItems).toHaveLength(0);
    expect(w.runs.get(recurringRunId('r1', iso(OCC)))).toMatchObject({
      status: 'skipped',
      reason: 'rate limit',
    });
    // Skipped runs also move the schedule on: it does not repeat every tick.
    expect(w.automations.get('r1')?.nextRunAtMs).toBe(OCC + 24 * HOUR);
  });

  it('a creator who lost access switches the recipe off with a skipped record', async () => {
    const w = makeWorld({ board: { ...makeWorld().board, access: {} }, roles: {} });
    add(w, recurring({ nextRunAtMs: OCC }));
    await runTick(deps(w, OCC + 1000), OCC + 1000);
    expect(w.automations.get('r1')?.enabled).toBe(false);
    expect([...w.runs.values()][0]).toMatchObject({ status: 'skipped' });
  });

  it('the circuit breaker switches a failing recipe off after the 10th failure', async () => {
    const w = makeWorld();
    add(
      w,
      recurring(
        {
          nextRunAtMs: OCC,
          consecutiveFailures: CIRCUIT_BREAKER_FAILURES - 1,
          actions: [{ type: 'create_item', name: 'x', groupId: 'gone' }],
        },
        {},
      ),
    );
    const summary = await runTick(deps(w, OCC + 1000), OCC + 1000);
    expect(summary.outcomes.failed).toBe(1);
    const a = w.automations.get('r1');
    expect(a?.enabled).toBe(false);
    expect(a?.disabledReason).toContain('Turned off after');
    expect(w.runs.get(recurringRunId('r1', iso(OCC)))?.status).toBe('failed');
    // The creator hears about it.
    expect(w.notifications.map((n) => n.data.kind)).toEqual(['automation_disabled']);
  });

  it('a transient error leaves lastTickAt alone so the next tick retries the window', async () => {
    const w = makeWorld({ lastTickMs: OCC - 5 * 60_000 });
    add(w, recurring({ nextRunAtMs: OCC }));
    w.failNextTransaction = true;
    const failed = await runTick(deps(w, OCC + 1000), OCC + 1000);
    expect(failed.hadErrors).toBe(true);
    expect(w.lastTickMs).toBe(OCC - 5 * 60_000);
    const retry = await runTick(deps(w, OCC + 301_000), OCC + 301_000);
    expect(retry.hadErrors).toBe(false);
    expect(w.createdItems).toHaveLength(1);
    expect(w.lastTickMs).toBe(OCC + 301_000);
  });
});

describe('date arrives recipes', () => {
  // Wednesday 2026-11-04. Madrid is UTC+1: 08:00 local = 07:00Z, 09:05 local = 08:05Z.
  const day = (h: number, m = 0) => Date.UTC(2026, 10, 4, h, m);
  const item = (date: string, extra: Record<string, unknown> = {}): StoredItem => ({
    name: 'Plan',
    state: 'active',
    values: { due: { date, ...extra } },
  });

  it('waits for the time of day, then fires once', async () => {
    const w = makeWorld({ lastTickMs: day(6, 55) });
    add(w, dateArrives());
    w.items.set('i1', item('2026-11-04'));
    // 08:00 local: too early.
    const early = await runTick(deps(w, day(7, 0)), day(7, 0));
    expect(early.dateRuns).toBe(0);
    expect(w.lastTickMs).toBe(day(7, 0));
    // 09:05 local: due.
    const due = await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(due.dateRuns).toBe(1);
    expect(w.notifications).toHaveLength(1);
    expect(w.runs.has(dateRunId('d1', 'i1', '2026-11-04'))).toBe(true);
    // Later ticks of the same day do nothing more.
    const later = await runTick(deps(w, day(9, 0)), day(9, 0));
    expect(later.dateRuns).toBe(0);
    expect(w.notifications).toHaveLength(1);
  });

  it('uses the time of the date cell when the recipe has no time of its own', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    add(w, dateArrives({}, { at: undefined }));
    w.items.set('i1', item('2026-11-04', { time: '15:30:00' }));
    await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(w.runs.size).toBe(0); // 09:05 local, cell says 15:30
    await runTick(deps(w, day(14, 35)), day(14, 35)); // 15:35 local
    expect(w.runs.size).toBe(1);
  });

  it('falls back to 09:00 with neither', async () => {
    const w = makeWorld({ lastTickMs: day(7, 50) });
    add(w, dateArrives({}, { at: undefined }));
    w.items.set('i1', item('2026-11-04'));
    await runTick(deps(w, day(7, 55)), day(7, 55)); // 08:55 local
    expect(w.runs.size).toBe(0);
    await runTick(deps(w, day(8, 2)), day(8, 2)); // 09:02 local
    expect(w.runs.size).toBe(1);
  });

  it('counts offset days: 3 days before the date', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    add(w, dateArrives({}, { offsetDays: -3 }));
    w.items.set('i1', item('2026-11-07'));
    w.items.set('i2', item('2026-11-08'));
    await runTick(deps(w, day(8, 5)), day(8, 5));
    expect([...w.runs.keys()]).toEqual([dateRunId('d1', 'i1', '2026-11-07')]);
  });

  it('editing the date back and forth fires once', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    add(w, dateArrives());
    w.items.set('i1', item('2026-11-04'));
    await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(w.notifications).toHaveLength(1);
    // Moved away, then moved back to the same day, then ticks again (a retried window too).
    w.items.set('i1', item('2026-11-20'));
    await runTick(deps(w, day(8, 10)), day(8, 10));
    w.items.set('i1', item('2026-11-04'));
    w.lastTickMs = day(7, 55);
    const summary = await runTick(deps(w, day(8, 15)), day(8, 15));
    expect(summary.outcomes.none).toBe(1);
    expect(w.notifications).toHaveLength(1);
    expect(w.runs.size).toBe(1);
  });

  it('an archived item does not fire', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    add(w, dateArrives());
    w.items.set('i1', { ...item('2026-11-04'), state: 'archived' });
    await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(w.runs.size).toBe(0);
    expect(w.notifications).toHaveLength(0);
  });

  it('the runner also refuses an item that is archived by the time it runs', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    add(w, dateArrives());
    w.items.set('i1', { ...item('2026-11-04'), state: 'archived' });
    const store = makeSchedulerStore(w);
    store.listItemsByDateKey = async () => [
      { id: 'i1', name: 'Plan', values: w.items.get('i1')!.values },
    ];
    await runTick(deps(w, day(8, 5), store), day(8, 5));
    expect(w.runs.get(dateRunId('d1', 'i1', '2026-11-04'))).toMatchObject({
      status: 'skipped',
      reason: 'item not active',
    });
    expect(w.notifications).toHaveLength(0);
  });

  it('only catches up the last 24 hours after a long outage', async () => {
    const w = makeWorld({ lastTickMs: day(8, 5) - 30 * HOUR });
    add(w, dateArrives({}, { at: undefined }));
    w.items.set('old', item('2026-11-02', { time: '15:30:00' })); // 2 days back
    w.items.set('early', item('2026-11-03')); // 09:00 on the 3rd: 24h05 back, beyond the cap
    w.items.set('yesterday', item('2026-11-03', { time: '15:30:00' })); // 17h35 back
    w.items.set('today', item('2026-11-04'));
    await runTick(deps(w, day(8, 5)), day(8, 5));
    expect([...w.runs.keys()].sort()).toEqual(
      [dateRunId('d1', 'today', '2026-11-04'), dateRunId('d1', 'yesterday', '2026-11-03')].sort(),
    );
  });

  it('a 3 hour outage fires the date once', async () => {
    const w = makeWorld({ lastTickMs: day(5, 0) });
    add(w, dateArrives());
    w.items.set('i1', item('2026-11-04'));
    await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(w.runs.size).toBe(1);
    expect(w.notifications).toHaveLength(1);
  });

  it('still obeys the rate limit: runs over the limit are recorded skipped, not dropped', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    w.counter = { hourBucket: hourBucketOf(day(8, 5)), runs: MAX_RUNS_PER_HOUR - 1 };
    add(w, dateArrives());
    w.items.set('i1', item('2026-11-04'));
    w.items.set('i2', item('2026-11-04'));
    w.items.set('i3', item('2026-11-04'));
    const summary = await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(summary.outcomes.ok).toBe(1);
    expect(summary.outcomes.skipped).toBe(2);
    expect([...w.runs.values()].filter((r) => r.reason === 'rate limit')).toHaveLength(2);
  });

  it('the circuit breaker switches a failing recipe off and stops feeding it', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    add(
      w,
      dateArrives({
        consecutiveFailures: CIRCUIT_BREAKER_FAILURES - 1,
        actions: [{ type: 'set_value', columnId: 'gone', value: 'x' }],
      }),
    );
    w.items.set('i1', item('2026-11-04'));
    w.items.set('i2', item('2026-11-04'));
    const summary = await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(summary.outcomes.failed).toBe(1);
    expect(w.automations.get('d1')?.enabled).toBe(false);
    expect(w.runs.size).toBe(1);
  });

  it('ignores disabled recipes', async () => {
    const w = makeWorld({ lastTickMs: day(7, 55) });
    add(w, dateArrives({ enabled: false }));
    w.items.set('i1', item('2026-11-04'));
    await runTick(deps(w, day(8, 5)), day(8, 5));
    expect(w.runs.size).toBe(0);
  });
});
