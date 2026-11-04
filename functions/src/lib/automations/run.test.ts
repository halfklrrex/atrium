import type { BoardRole, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import type { NewActivity } from '../activity';
import type { BoardData, ItemData } from '../column-actions';
import type { NewNotification, NotificationStore } from '../notifications';
import {
  handleActivityEvent,
  runAutomation,
  type ActivityEntryInput,
  type AutomationDoc,
  type AutomationRunTx,
  type AutomationStore,
  type RunRecord,
} from './run';
import { CIRCUIT_BREAKER_FAILURES, MAX_RUNS_PER_HOUR } from './limits';

const NOW = Date.UTC(2026, 10, 4, 9, 30);
const BUCKET = '2026-11-04T09';

interface World {
  board: BoardData;
  roles: Record<string, WorkspaceRole>;
  item: ItemData | null;
  automations: Map<string, AutomationDoc>;
  runs: Map<string, RunRecord>;
  counter: { hourBucket: string; runs: number } | null;
  activities: NewActivity[];
  itemPatches: Array<Record<string, unknown>>;
  notifications: Array<{ uid: string; id: string; data: NewNotification }>;
}

const automation = (over: Partial<AutomationDoc> = {}): AutomationDoc => ({
  id: 'a1',
  name: 'Ship it',
  enabled: true,
  trigger: { type: 'item_created' },
  conditions: [],
  actions: [{ type: 'set_value', columnId: 'stage', value: 'Done' }],
  runAs: 'creator',
  disabledReason: null,
  consecutiveFailures: 0,
  ...over,
});

function makeWorld(over: Partial<World> = {}): World {
  const a = automation();
  return {
    board: {
      kind: 'main',
      workspaceId: 'ws',
      access: { creator: 'owner' as BoardRole },
      columns: [{ id: 'stage', type: 'text', title: 'Stage', settings: {} }],
      groups: [{ id: 'g1' }],
      memberUids: ['creator', 'pal'],
    },
    roles: { creator: 'member', pal: 'member' },
    item: { id: 'i1', name: 'Task', state: 'active', values: {} },
    automations: new Map([[a.id, a]]),
    runs: new Map(),
    counter: null,
    activities: [],
    itemPatches: [],
    notifications: [],
    ...over,
  };
}

function makeStore(w: World): AutomationStore {
  return {
    async transact(fn) {
      const pending: Array<() => void> = [];
      const tx: AutomationRunTx = {
        async getBoard() {
          return w.board;
        },
        async getWorkspaceMemberRole(_ws, uid) {
          return w.roles[uid] ?? null;
        },
        async getItem() {
          return w.item ? structuredClone(w.item) : null;
        },
        updateItemValues() {
          throw new Error('unused');
        },
        updateItem(_b, _i, patch) {
          pending.push(() => w.itemPatches.push(patch));
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
        nowMs: () => NOW,
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
            if (a) w.automations.set(id, { ...a, ...fields } as AutomationDoc);
          });
        },
      };
      const result = await fn(tx);
      pending.forEach((apply) => apply());
      return result;
    },
    async listEnabledAutomations(_b, limit) {
      return [...w.automations.values()].filter((a) => a.enabled).slice(0, limit);
    },
    async noteRun() {},
  };
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

const request = { boardId: 'b1', automationId: 'a1', eventId: 'e1', itemId: 'i1', depth: 0 };
const created: ActivityEntryInput = {
  kind: 'item_created',
  actorId: 'human',
  itemId: 'i1',
  itemName: 'Task',
  columnId: null,
  groupId: 'g1',
  data: {},
};

describe('runAutomation', () => {
  it('applies the actions with the loop marker and records the run and an automation_ran entry', async () => {
    const w = makeWorld();
    const out = await runAutomation(makeStore(w), request, 'TS');
    expect(out.status).toBe('ok');
    expect(w.itemPatches).toEqual([
      {
        'values.stage': 'Done',
        updatedVia: 'automation:a1',
        automationDepth: 1,
        automationRunId: 'a1-e1',
      },
    ]);
    expect(w.runs.get('a1-e1')).toMatchObject({ status: 'ok', actions: ['set_value'], depth: 0 });
    expect(w.counter).toEqual({ hourBucket: BUCKET, runs: 1 });
    expect(w.activities).toHaveLength(1);
    expect(w.activities[0]).toMatchObject({
      kind: 'automation_ran',
      actorId: 'automation:a1',
      actorName: 'Ship it',
      data: { automationId: 'a1', depth: 1 },
    });
  });

  it('does not run twice for the same event', async () => {
    const w = makeWorld();
    const store = makeStore(w);
    await runAutomation(store, request, 'TS');
    const second = await runAutomation(store, request, 'TS');
    expect(second).toMatchObject({ status: 'none', reason: 'already ran' });
    expect(w.itemPatches).toHaveLength(1);
    expect(w.counter?.runs).toBe(1);
  });

  it('skips with "loop limit" at the maximum depth', async () => {
    const w = makeWorld();
    const out = await runAutomation(makeStore(w), { ...request, depth: 3 }, 'TS');
    expect(out).toMatchObject({ status: 'skipped', reason: 'loop limit' });
    expect(w.itemPatches).toEqual([]);
    expect(w.runs.get('a1-e1')).toMatchObject({ status: 'skipped', reason: 'loop limit' });
  });

  it('skips with "rate limit" after 100 runs in the hour, and starts over in a new hour', async () => {
    const w = makeWorld({ counter: { hourBucket: BUCKET, runs: MAX_RUNS_PER_HOUR } });
    const out = await runAutomation(makeStore(w), request, 'TS');
    expect(out).toMatchObject({ status: 'skipped', reason: 'rate limit' });
    expect(w.itemPatches).toEqual([]);

    const later = makeWorld({ counter: { hourBucket: '2026-11-04T08', runs: MAX_RUNS_PER_HOUR } });
    expect((await runAutomation(makeStore(later), request, 'TS')).status).toBe('ok');
    expect(later.counter).toEqual({ hourBucket: BUCKET, runs: 1 });
  });

  it('skips and disables the automation when the creator lost edit access', async () => {
    const w = makeWorld();
    w.board.access = { creator: 'viewer' as BoardRole };
    const out = await runAutomation(makeStore(w), request, 'TS');
    expect(out).toMatchObject({ status: 'skipped', reason: 'creator lost access' });
    expect(w.automations.get('a1')).toMatchObject({ enabled: false });
    expect(w.automations.get('a1')?.disabledReason).toBeTruthy();
    expect(w.itemPatches).toEqual([]);
  });

  it('records nothing when the conditions do not hold', async () => {
    const w = makeWorld();
    w.automations.set(
      'a1',
      automation({ conditions: [{ columnId: 'stage', op: 'is', value: 'Open' }] }),
    );
    const out = await runAutomation(makeStore(w), request, 'TS');
    expect(out).toMatchObject({ status: 'none', reason: 'conditions not met' });
    expect(w.runs.size).toBe(0);
    expect(w.counter).toBeNull();
  });

  it('skips an item that is not active and a disabled automation', async () => {
    const w = makeWorld();
    w.item = { id: 'i1', name: 'Task', state: 'archived', values: {} };
    expect(await runAutomation(makeStore(w), request, 'TS')).toMatchObject({
      status: 'skipped',
      reason: 'item not active',
    });
    const off = makeWorld();
    off.automations.set('a1', automation({ enabled: false }));
    expect((await runAutomation(makeStore(off), request, 'TS')).status).toBe('none');
  });

  it('records a failed run when the actions no longer validate, and counts it', async () => {
    const w = makeWorld();
    w.automations.set(
      'a1',
      automation({ actions: [{ type: 'set_value', columnId: 'gone', value: 'x' }] }),
    );
    const out = await runAutomation(makeStore(w), request, 'TS');
    expect(out).toMatchObject({ status: 'failed', disabled: false });
    expect(w.runs.get('a1-e1')).toMatchObject({ status: 'failed' });
    expect(w.automations.get('a1')?.consecutiveFailures).toBe(1);
    expect(w.itemPatches).toEqual([]);
  });

  it('trips the circuit breaker on the tenth failure and a success resets the count', async () => {
    const w = makeWorld();
    w.automations.set(
      'a1',
      automation({
        actions: [{ type: 'set_value', columnId: 'gone', value: 'x' }],
        consecutiveFailures: CIRCUIT_BREAKER_FAILURES - 1,
      }),
    );
    const out = await runAutomation(makeStore(w), request, 'TS');
    expect(out).toMatchObject({ status: 'failed', disabled: true });
    expect(w.automations.get('a1')).toMatchObject({ enabled: false, consecutiveFailures: 10 });

    // A recipe that works resets the count.
    const ok = makeWorld();
    ok.automations.set('a1', automation({ consecutiveFailures: 4 }));
    expect((await runAutomation(makeStore(ok), request, 'TS')).status).toBe('ok');
    expect(ok.automations.get('a1')?.consecutiveFailures).toBe(0);

    // Owner re-enabled a tripped recipe: the runner starts the count again.
    const again = makeWorld();
    again.automations.set(
      'a1',
      automation({ consecutiveFailures: 10, disabledReason: 'Turned off' }),
    );
    expect((await runAutomation(makeStore(again), request, 'TS')).status).toBe('ok');
    expect(again.automations.get('a1')).toMatchObject({
      consecutiveFailures: 0,
      disabledReason: null,
    });
  });
});

describe('handleActivityEvent', () => {
  const deps = (w: World) => ({
    store: makeStore(w),
    notifications: makeNotifications(w),
    serverTimestamp: 'TS',
  });

  it('runs matching recipes only', async () => {
    const w = makeWorld();
    w.automations.set(
      'a2',
      automation({ id: 'a2', trigger: { type: 'button_clicked', columnId: 'btn' } }),
    );
    const out = await handleActivityEvent(deps(w), {
      eventId: 'e1',
      boardId: 'b1',
      activity: created,
    });
    expect(out.map((o) => o.status)).toEqual(['ok']);
    expect(w.runs.has('a1-e1')).toBe(true);
    expect(w.runs.has('a2-e1')).toBe(false);
  });

  it('ignores entries without an item, board-level kinds and automation_ran', async () => {
    const w = makeWorld();
    for (const activity of [
      { ...created, itemId: null },
      { ...created, kind: 'column_added' },
      { ...created, kind: 'automation_ran' },
    ]) {
      expect(await handleActivityEvent(deps(w), { eventId: 'e', boardId: 'b1', activity })).toEqual(
        [],
      );
    }
  });

  it('never lets a recipe react to its own write, but another recipe may', async () => {
    const w = makeWorld();
    const status = { index: 1 };
    w.automations.set(
      'a1',
      automation({ trigger: { type: 'status_changed', columnId: 'status' } }),
    );
    w.automations.set(
      'a2',
      automation({ id: 'a2', trigger: { type: 'status_changed', columnId: 'status' } }),
    );
    const out = await handleActivityEvent(deps(w), {
      eventId: 'e1',
      boardId: 'b1',
      activity: {
        ...created,
        kind: 'value_changed',
        columnId: 'status',
        actorId: 'automation:a1',
        data: { toValue: status, depth: 1 },
      },
    });
    expect(out).toHaveLength(1);
    expect(w.runs.has('a2-e1')).toBe(true);
    expect(w.itemPatches[0]).toMatchObject({ automationDepth: 2 });
  });

  it('only records "loop limit" for an event at depth 3', async () => {
    const w = makeWorld();
    const out = await handleActivityEvent(deps(w), {
      eventId: 'e1',
      boardId: 'b1',
      activity: { ...created, actorId: 'automation:other', data: { depth: 3 } },
    });
    expect(out).toMatchObject([{ status: 'skipped', reason: 'loop limit' }]);
    expect(w.itemPatches).toEqual([]);
  });

  it('considers at most 20 recipes', async () => {
    const w = makeWorld();
    for (let i = 2; i <= 25; i += 1) {
      w.automations.set(`a${i}`, automation({ id: `a${i}` }));
    }
    const out = await handleActivityEvent(deps(w), {
      eventId: 'e1',
      boardId: 'b1',
      activity: created,
    });
    expect(out).toHaveLength(20);
  });

  it('notifies the named people after the commit, naming the creator and the recipe', async () => {
    const w = makeWorld();
    w.automations.set(
      'a1',
      automation({
        actions: [{ type: 'notify', uids: ['pal', 'creator'], message: 'Look at this' }],
      }),
    );
    await handleActivityEvent(deps(w), { eventId: 'e1', boardId: 'b1', activity: created });
    expect(w.notifications.map((n) => n.uid).sort()).toEqual(['creator', 'pal']);
    expect(w.notifications[0]?.data).toMatchObject({
      kind: 'automation',
      actorId: 'creator',
      recipeName: 'Ship it',
      snippet: 'Look at this',
    });
    expect(w.notifications[0]?.id).toMatch(/^automation-a1-e1-/);
  });

  it('sends exactly one automation_disabled notice when the breaker trips', async () => {
    const w = makeWorld();
    w.automations.set(
      'a1',
      automation({
        actions: [{ type: 'set_value', columnId: 'gone', value: 'x' }],
        consecutiveFailures: CIRCUIT_BREAKER_FAILURES - 1,
      }),
    );
    const d = deps(w);
    await handleActivityEvent(d, { eventId: 'e1', boardId: 'b1', activity: created });
    // The automation is now off, so a later event finds nothing to run.
    await handleActivityEvent(d, { eventId: 'e2', boardId: 'b1', activity: created });
    const notices = w.notifications.filter((n) => n.data.kind === 'automation_disabled');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ uid: 'creator' });
    expect(notices[0]?.data.snippet).toContain('10 failed runs');
  });
});
