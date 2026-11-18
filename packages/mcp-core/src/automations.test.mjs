// Batch 4 PR 2: the Automations tools (list, runs, create, update, enable, delete). In-memory Firestore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automationSchema, validateAutomation } from '@atrium/shared';
import { addLabelsToSettings, buildColumnSettings, ts } from './builders.mjs';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { defineTools } from './tools.mjs';

const WS = 'ws1';
const ME = 'user-me'; // workspace owner, board owner
const ED = 'user-ed'; // member, board editor
const VW = 'user-vw'; // viewer
const OTHER = 'user-other'; // a second board owner
const NOW = new Date('2026-11-18T10:00:00Z');
const LONG_AGO = new Date('2026-11-01T08:00:00Z');

const col = (id, type, title, settings = {}) => ({ id, type, title, position: id, settings });
const columns = [
  col('st', 'status', 'Status', buildColumnSettings('status')),
  col('who', 'people', 'Owner'),
  col('cost', 'numbers', 'Cost'),
  col(
    'kind',
    'dropdown',
    'Kind',
    addLabelsToSettings('dropdown', buildColumnSettings('dropdown'), ['Home', 'Work']),
  ),
  col('due', 'date', 'Due'),
  col('note', 'text', 'Note'),
  col('go', 'button', 'Go', { label: 'Go', color: '#579bfc', actions: [] }),
  col('dbl', 'formula', 'Double', { expression: '{Cost} * 2', outputType: 'number' }),
];
const groups = [
  { id: 'g1', title: 'To do', color: '#579bfc', position: 'a0' },
  { id: 'g2', title: 'Done', color: '#00c875', position: 'a1' },
];

const board = (more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'main',
  access: { [ME]: 'owner', [ED]: 'editor', [VW]: 'viewer', [OTHER]: 'owner' },
  accessUids: [ME, ED, VW, OTHER],
  position: 'a0',
  folderId: null,
  name: 'Chores',
  columns,
  groups,
  ...more,
});

const stored = (more = {}) => ({
  name: 'Tell Sam',
  enabled: true,
  trigger: { type: 'status_changed', columnId: 'st', toLabelId: 1 },
  conditions: [],
  actions: [{ type: 'notify', uids: [ED], message: 'Done!' }],
  runAs: OTHER,
  disabledReason: null,
  createdBy: OTHER,
  createdAt: LONG_AGO,
  updatedBy: OTHER,
  updatedAt: LONG_AGO,
  ...more,
});

const docs = (extra = {}) => ({
  [`workspaces/${WS}`]: {
    name: 'Home',
    ownerId: ME,
    roles: { [ME]: 'owner', [ED]: 'member', [VW]: 'viewer', [OTHER]: 'member' },
    memberIds: [ME, ED, VW, OTHER],
  },
  [`workspaces/${WS}/members/${ME}`]: {
    displayName: 'Avery Quinn',
    email: 'avery@example.com',
    profile: { timeZone: 'Europe/Brussels' },
  },
  [`workspaces/${WS}/members/${ED}`]: { displayName: 'Sam Rivera', email: 'sam@example.com' },
  [`workspaces/${WS}/members/${OTHER}`]: { displayName: 'Robin Hale', email: 'robin@example.com' },
  'boards/b1': board(),
  ...extra,
});

function setup({ actor = ME, extra = {} } = {}) {
  const client = createFakeClient(docs(extra));
  const service = createService({ client, actor: { uid: actor }, now: () => NOW });
  const tools = defineTools(service);
  const run = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  const stash = () =>
    [...client.docs.keys()].filter((k) => k.startsWith('boards/b1/automations/')).sort();
  return { client, run, tools, stash };
}

const refuses = (promise, pattern) => assert.rejects(promise, pattern);

const doneRecipe = {
  boardId: 'b1',
  name: 'Tell Sam',
  trigger: { type: 'status_changed', column: 'Status', to: 'Done' },
  actions: [{ type: 'notify', people: ['sam@example.com'], message: 'Done!' }],
};

test('create is switched off by default, runs as the actor, and parses as a valid automation', async () => {
  const { client, run, stash } = setup();
  const result = await run('atrium_create_automation', doneRecipe);
  assert.equal(result.created.enabled, false);
  assert.equal(result.created.sentence, 'When Status changes to Done, notify Sam Rivera.');
  assert.match(result.note, /switched off/);
  const [path] = stash();
  const data = client.docs.get(path).data;
  assert.equal(data.runAs, ME);
  assert.equal(data.createdBy, ME);
  assert.equal(data.updatedBy, ME);
  assert.equal(data.disabledReason, null);
  assert.deepEqual(data.trigger, { type: 'status_changed', columnId: 'st', toLabelId: 1 });
  assert.deepEqual(data.actions, [{ type: 'notify', uids: [ED], message: 'Done!' }]);
  assert.equal('nextRunAt' in data, false);
  assert.equal('consecutiveFailures' in data, false);
  const parsed = automationSchema.safeParse({ ...data, createdAt: ts(NOW), updatedAt: ts(NOW) });
  assert.equal(parsed.success, true, parsed.error?.message);
});

test('enabled: true switches it on at creation', async () => {
  const { client, run, stash } = setup();
  const result = await run('atrium_create_automation', { ...doneRecipe, enabled: true });
  assert.equal(result.created.enabled, true);
  assert.equal(client.docs.get(stash()[0]).data.enabled, true);
});

test('every trigger and action type round trips through list', async () => {
  const { client, run, stash } = setup();
  const recipes = [
    [{ type: 'item_created', group: 'To do' }, [{ type: 'archive_item' }]],
    [{ type: 'item_moved', group: 'Done' }, [{ type: 'rename_item', template: '{name} ({date})' }]],
    [{ type: 'status_changed', column: 'Status' }, [{ type: 'move_to_group', group: 'Done' }]],
    [
      { type: 'button_clicked', column: 'Go' },
      [{ type: 'set_value', column: 'Status', value: 'Done' }],
    ],
    [
      { type: 'person_assigned', column: 'Owner', person: 'sam@example.com' },
      [{ type: 'post_update', text: 'Hello {name}' }],
    ],
    [
      { type: 'date_arrives', column: 'Due', offsetDays: -1, at: '08:30' },
      [{ type: 'set_value', column: 'Kind', value: ['Home', 'Work'] }],
    ],
    [
      { type: 'recurring', every: 'week', weekday: 'Monday', at: '09:00' },
      [
        {
          type: 'create_item',
          name: 'Weekly {date}',
          group: 'To do',
          values: { Status: 'Done', Cost: 3 },
        },
      ],
    ],
  ];
  for (const [i, [trigger, actions]] of recipes.entries()) {
    const created = await run('atrium_create_automation', {
      boardId: 'b1',
      name: `R${i}`,
      trigger,
      actions,
      conditions:
        i === 3
          ? [
              { column: 'Cost', op: 'is', value: 5 },
              { column: 'Note', op: 'is_not_empty' },
            ]
          : [],
    });
    assert.ok(created.created.sentence.length > 10);
  }
  assert.equal(stash().length, recipes.length);
  const listed = await run('atrium_list_automations', { boardId: 'b1' });
  assert.equal(listed.automations.length, recipes.length);
  // Feeding each listed structure back into create gives the same stored recipe.
  for (const entry of listed.automations) {
    const before = client.docs.get(`boards/b1/automations/${entry.id}`).data;
    const again = await run('atrium_create_automation', {
      boardId: 'b1',
      name: 'again',
      trigger: entry.trigger,
      conditions: entry.conditions,
      actions: entry.actions.map((a) => (a.type === 'notify' ? { ...a } : a)),
      ...(entry.timezone ? { timezone: entry.timezone } : {}),
    }).catch((error) => error);
    if (again instanceof Error) {
      // The board hit the scheduled or total limit: only that is acceptable here.
      assert.match(again.message, /at most/);
      continue;
    }
    const copy = client.docs.get(`boards/b1/automations/${again.created.id}`).data;
    for (const key of ['trigger', 'conditions', 'actions', 'timezone']) {
      assert.deepEqual(copy[key], before[key], key);
    }
    client.docs.delete(`boards/b1/automations/${again.created.id}`);
  }
  const recurring = listed.automations.find((a) => a.trigger.type === 'recurring');
  assert.equal(recurring.timezone, 'Europe/Brussels');
  assert.equal(recurring.sentence.startsWith('Every Monday at 09:00 (Europe/Brussels)'), true);
  const withConditions = listed.automations.find((a) => a.conditions.length > 0);
  assert.match(withConditions.sentence, /only if Cost is 5 and Note is not empty/);
});

test('a created recipe passes the shared validator and the stored values are the cell forms', async () => {
  const { client, run, stash } = setup();
  await run('atrium_create_automation', {
    boardId: 'b1',
    name: 'Set',
    trigger: { type: 'button_clicked', column: 'Go' },
    conditions: [{ column: 'Kind', op: 'is', value: 'Home' }],
    actions: [{ type: 'set_value', column: 'Owner', value: 'me' }],
  });
  const data = client.docs.get(stash()[0]).data;
  assert.deepEqual(data.conditions, [
    { columnId: 'kind', op: 'is', value: { ids: [data.conditions[0].value.ids[0]] } },
  ]);
  assert.deepEqual(data.actions[0].value, { personsAndTeams: [{ id: ME, kind: 'person' }] });
  const checked = validateAutomation(
    data,
    { columns, groups, memberUids: [ME, ED, VW, OTHER] },
    'owner',
  );
  assert.equal(checked.ok, true);
});

test('invalid references and recipes are refused and nothing is written', async () => {
  const { run, stash } = setup();
  const make = (patch) => run('atrium_create_automation', { ...doneRecipe, ...patch });
  await refuses(make({ trigger: { type: 'status_changed', column: 'Nope' } }), /No column/);
  await refuses(
    make({ trigger: { type: 'status_changed', column: 'Cost' } }),
    /needs a status column/,
  );
  await refuses(
    make({ trigger: { type: 'status_changed', column: 'Status', to: 'Banana' } }),
    /not a label/,
  );
  await refuses(make({ trigger: { type: 'item_created', group: 'Nowhere' } }), /No group/);
  await refuses(make({ trigger: { type: 'weekly' } }), /./);
  await refuses(make({ actions: [{ type: 'delete_everything' }] }), /./);
  await refuses(make({ actions: [] }), /./);
  await refuses(
    make({ actions: [{ type: 'notify', people: ['stranger@example.com'] }] }),
    /not a member/,
  );
  await refuses(
    make({ actions: [{ type: 'notify', people: ['sam@example.com', 'user-ed'] }] }),
    /listed twice/,
  );
  await refuses(
    make({ actions: [{ type: 'set_value', column: 'Double', value: 4 }] }),
    /calculated/,
  );
  await refuses(
    make({ actions: [{ type: 'set_value', column: 'Go', value: 1 }] }),
    /cannot be set|button/,
  );
  await refuses(
    make({ actions: [{ type: 'set_value', column: 'Status', value: 'Banana' }] }),
    /not a label|option/,
  );
  await refuses(make({ conditions: [{ column: 'Owner', op: 'is_empty' }] }), /cannot be checked/);
  await refuses(make({ conditions: [{ column: 'Status', op: 'is' }] }), /needs a value/);
  await refuses(
    make({ conditions: Array.from({ length: 4 }, () => ({ column: 'Note', op: 'is_empty' })) }),
    /at most 3|invalid|Too big/i,
  );
  await refuses(
    make({
      actions: [
        { type: 'create_item', name: 'a' },
        { type: 'create_item', name: 'b' },
      ],
    }),
    /At most 1 Create item/,
  );
  await refuses(
    make({
      trigger: { type: 'recurring', every: 'day', at: '09:00' },
      actions: [{ type: 'archive_item' }],
    }),
    /recurring recipe can only/,
  );
  await refuses(
    make({
      trigger: { type: 'recurring', every: 'week', at: '09:00' },
      actions: [{ type: 'notify', people: ['me'] }],
    }),
    /weekday/,
  );
  await refuses(make({ timezone: 'Europe/Brussels' }), /only applies/);
  await refuses(
    make({
      trigger: { type: 'recurring', every: 'day', at: '09:00' },
      actions: [{ type: 'notify', people: ['me'] }],
      timezone: 'Mars/Olympus',
    }),
    /time zone/i,
  );
  await refuses(make({ name: 'x'.repeat(81) }), /at most 80/);
  assert.equal(stash().length, 0);
});

test('a scheduled recipe needs a time zone when the profile has none', async () => {
  const { run } = setup({
    extra: { [`workspaces/${WS}/members/${ME}`]: { displayName: 'Avery Quinn' } },
  });
  await refuses(
    run('atrium_create_automation', {
      boardId: 'b1',
      name: 'Daily',
      trigger: { type: 'recurring', every: 'day', at: '09:00' },
      actions: [{ type: 'notify', people: ['me'] }],
    }),
    /needs a time zone/,
  );
  const ok = await run('atrium_create_automation', {
    boardId: 'b1',
    name: 'Daily',
    trigger: { type: 'recurring', every: 'day', at: '09:00' },
    actions: [{ type: 'notify', people: ['me'] }],
    timezone: 'Europe/Madrid',
  });
  assert.equal(ok.created.timezone, 'Europe/Madrid');
});

test('a profile zone outside the fixed list is not used silently', async () => {
  const { run } = setup({
    extra: {
      [`workspaces/${WS}/members/${ME}`]: {
        displayName: 'Avery',
        profile: { timeZone: 'Europe/Amsterdam' },
      },
    },
  });
  await refuses(
    run('atrium_create_automation', {
      boardId: 'b1',
      name: 'Daily',
      trigger: { type: 'recurring', every: 'day', at: '09:00' },
      actions: [{ type: 'notify', people: ['me'] }],
    }),
    /not in Atrium's time zone list/,
  );
});

test('limits: 20 per board and 5 scheduled', async () => {
  const many = {};
  for (let i = 0; i < 20; i += 1)
    many[`boards/b1/automations/a${i}`] = stored({
      name: `n${i}`,
      createdAt: new Date(LONG_AGO.getTime() + i),
    });
  const full = setup({ extra: many });
  await refuses(full.run('atrium_create_automation', doneRecipe), /at most 20 automations/);

  const sched = {};
  for (let i = 0; i < 5; i += 1) {
    sched[`boards/b1/automations/s${i}`] = stored({
      name: `s${i}`,
      trigger: { type: 'recurring', every: 'day', at: '09:00' },
      actions: [{ type: 'notify', uids: [ED] }],
      timezone: 'Europe/Brussels',
      createdAt: new Date(LONG_AGO.getTime() + i),
    });
  }
  const five = setup({ extra: sched });
  await refuses(
    five.run('atrium_create_automation', {
      boardId: 'b1',
      name: 'six',
      trigger: { type: 'recurring', every: 'month', dayOfMonth: 1, at: '09:00' },
      actions: [{ type: 'notify', people: ['me'] }],
    }),
    /at most 5 scheduled/,
  );
  // An event recipe still fits.
  await five.run('atrium_create_automation', doneRecipe);
});

test('only board owners write or read runs; everyone who reads the board lists', async () => {
  const seed = { 'boards/b1/automations/a1': stored() };
  for (const actor of [ED, VW]) {
    const { run } = setup({ actor, extra: seed });
    const listed = await run('atrium_list_automations', { boardId: 'b1' });
    assert.equal(listed.canManage, false);
    assert.equal(listed.automations.length, 1);
    await refuses(run('atrium_create_automation', doneRecipe), /board owners/);
    await refuses(
      run('atrium_update_automation', { boardId: 'b1', automation: 'a1', name: 'x' }),
      /board owners/,
    );
    await refuses(
      run('atrium_set_automation_enabled', { boardId: 'b1', automation: 'a1', enabled: false }),
      /board owners/,
    );
    await refuses(
      run('atrium_delete_automation', { boardId: 'b1', automation: 'a1' }),
      /board owners/,
    );
    await refuses(run('atrium_list_automation_runs', { boardId: 'b1' }), /board owners/);
  }
  // Someone outside the workspace sees nothing.
  const { run } = setup({ actor: 'stranger', extra: seed });
  await refuses(run('atrium_list_automations', { boardId: 'b1' }), /not found/);
});

test('update keeps runAs unless takeOver, and tells when it is live', async () => {
  const seed = { 'boards/b1/automations/a1': stored() };
  const { client, run } = setup({ extra: seed });
  const first = await run('atrium_update_automation', {
    boardId: 'b1',
    automation: 'Tell Sam',
    name: 'Tell Sam!',
    actions: [{ type: 'notify', people: ['sam@example.com'], message: 'Finished' }],
  });
  const data = client.docs.get('boards/b1/automations/a1').data;
  assert.equal(data.name, 'Tell Sam!');
  assert.equal(data.runAs, OTHER);
  assert.equal(data.createdBy, OTHER);
  assert.equal(data.updatedBy, ME);
  assert.equal(data.enabled, true);
  assert.deepEqual(data.actions[0].message, 'Finished');
  assert.match(first.note, /switched on/);
  assert.match(first.note, /takeOver/);
  assert.equal(first.updated.runsAs.isYou, false);

  const second = await run('atrium_update_automation', {
    boardId: 'b1',
    automation: 'a1',
    takeOver: true,
  });
  assert.equal(client.docs.get('boards/b1/automations/a1').data.runAs, ME);
  assert.equal(second.updated.runsAs.isYou, true);
  await refuses(
    run('atrium_update_automation', { boardId: 'b1', automation: 'a1' }),
    /Nothing to change/,
  );
});

test('update moves between event and scheduled triggers and fixes the time zone field', async () => {
  const seed = { 'boards/b1/automations/a1': stored({ enabled: false }) };
  const { client, run } = setup({ extra: seed });
  await run('atrium_update_automation', {
    boardId: 'b1',
    automation: 'a1',
    trigger: { type: 'recurring', every: 'day', at: '07:00' },
    actions: [{ type: 'notify', people: ['sam@example.com'] }],
  });
  assert.equal(client.docs.get('boards/b1/automations/a1').data.timezone, 'Europe/Brussels');
  await run('atrium_update_automation', {
    boardId: 'b1',
    automation: 'a1',
    trigger: { type: 'item_created' },
  });
  assert.equal('timezone' in client.docs.get('boards/b1/automations/a1').data, false);
  // The whole recipe is checked again: an action that no longer fits the trigger is refused.
  await refuses(
    run('atrium_update_automation', {
      boardId: 'b1',
      automation: 'a1',
      trigger: { type: 'recurring', every: 'day', at: '07:00' },
      actions: [{ type: 'archive_item' }],
    }),
    /recurring recipe can only/,
  );
});

test('set_enabled switches, clears the reason, is idempotent and re-checks the board', async () => {
  const seed = {
    'boards/b1/automations/a1': stored({
      enabled: false,
      disabledReason: 'Switched off after 5 failures',
    }),
    'boards/b1/automations/a2': stored({
      name: 'Broken',
      enabled: false,
      trigger: { type: 'status_changed', columnId: 'gone' },
    }),
  };
  const { client, run } = setup({ extra: seed });
  const on = await run('atrium_set_automation_enabled', {
    boardId: 'b1',
    automation: 'a1',
    enabled: true,
  });
  const data = client.docs.get('boards/b1/automations/a1').data;
  assert.equal(data.enabled, true);
  assert.equal(data.disabledReason, null);
  assert.equal(data.updatedBy, ME);
  assert.equal(data.runAs, OTHER);
  assert.match(on.note, /Robin Hale/);
  const commits = client.commits.length;
  const again = await run('atrium_set_automation_enabled', {
    boardId: 'b1',
    automation: 'a1',
    enabled: true,
  });
  assert.equal(again.unchanged, true);
  assert.equal(client.commits.length, commits);
  await run('atrium_set_automation_enabled', { boardId: 'b1', automation: 'a1', enabled: false });
  assert.equal(client.docs.get('boards/b1/automations/a1').data.enabled, false);
  await refuses(
    run('atrium_set_automation_enabled', { boardId: 'b1', automation: 'a2', enabled: true }),
    /column no longer exists/,
  );
  // Off is always allowed, even for a broken recipe.
  await run('atrium_set_automation_enabled', { boardId: 'b1', automation: 'a2', enabled: false });
});

test('delete returns the whole definition, which recreates it switched off', async () => {
  const seed = { 'boards/b1/automations/a1': stored() };
  const { client, run, stash } = setup({ extra: seed });
  const result = await run('atrium_delete_automation', { boardId: 'b1', automation: 'a1' });
  assert.equal(stash().length, 0);
  assert.equal(result.deleted.name, 'Tell Sam');
  assert.equal(result.deleted.enabled, true);
  const {
    id: _id,
    sentence: _s,
    runsAs: _r,
    disabledReason: _d,
    consecutiveFailures: _c,
    nextRunAt: _n,
    createdAt: _ca,
    updatedAt: _ua,
    enabled: _e,
    ...definition
  } = result.deleted;
  const back = await run('atrium_create_automation', { boardId: 'b1', ...definition });
  assert.equal(back.created.enabled, false);
  assert.equal(back.created.sentence, result.deleted.sentence);
  assert.equal(client.docs.get(stash()[0]).data.runAs, ME);
  await refuses(
    run('atrium_delete_automation', { boardId: 'b1', automation: 'a1' }),
    /No automation/,
  );
});

test('list: sentence, readable structure, runs-as, deleted references and ambiguous names', async () => {
  const seed = {
    'boards/b1/automations/a1': stored({
      disabledReason: 'Switched off after 5 failures',
      consecutiveFailures: 5,
      enabled: false,
    }),
    'boards/b1/automations/a2': stored({
      name: 'Tell Sam',
      createdAt: new Date(LONG_AGO.getTime() + 1000),
      trigger: { type: 'status_changed', columnId: 'gone' },
      actions: [{ type: 'move_to_group', groupId: 'gone' }],
    }),
  };
  const { run } = setup({ extra: seed });
  const listed = await run('atrium_list_automations', { boardId: 'b1' });
  assert.deepEqual(
    listed.automations.map((a) => a.id),
    ['a1', 'a2'],
  );
  const [a1, a2] = listed.automations;
  assert.equal(a1.sentence, 'When Status changes to Done, notify Sam Rivera.');
  assert.deepEqual(a1.trigger, { type: 'status_changed', column: 'Status', to: 'Done' });
  assert.equal(a1.runsAs.name, 'Robin Hale');
  assert.equal(a1.disabledReason, 'Switched off after 5 failures');
  assert.equal(a1.consecutiveFailures, 5);
  assert.match(a2.sentence, /a deleted column/);
  assert.match(a2.sentence, /a deleted group/);
  await refuses(
    run('atrium_delete_automation', { boardId: 'b1', automation: 'Tell Sam' }),
    /More than one/,
  );
  assert.ok(listed.limits.perBoard === 20);
});

test('runs: newest first, filtered by automation, kept to the window', async () => {
  const run = (i, automationId, status, extra = {}) => [
    `boards/b1/automationRuns/${automationId}-e${i}`,
    {
      automationId,
      eventId: `e${i}`,
      itemId: 'i1',
      status,
      actions: ['notify'],
      startedAt: new Date(LONG_AGO.getTime() + i * 60000),
      durationMs: 12,
      depth: 0,
      expiresAt: new Date(LONG_AGO.getTime() + 30 * 86400000),
      ...extra,
    },
  ];
  const seed = Object.fromEntries([
    ['boards/b1/automations/a1', stored()],
    ['boards/b1/automations/a2', stored({ name: 'Other' })],
    run(1, 'a1', 'ok'),
    run(2, 'a2', 'skipped', { reason: 'rate limit' }),
    run(3, 'a1', 'failed', { error: 'the group no longer exists' }),
  ]);
  const { run: call } = setup({ extra: seed });
  const all = await call('atrium_list_automation_runs', { boardId: 'b1' });
  assert.deepEqual(
    all.runs.map((r) => r.status),
    ['failed', 'skipped', 'ok'],
  );
  assert.equal(all.runs[0].error, 'the group no longer exists');
  assert.equal(all.runs[1].reason, 'rate limit');
  assert.equal(all.runs[1].automation, 'Other');
  const one = await call('atrium_list_automation_runs', { boardId: 'b1', automation: 'Tell Sam' });
  assert.deepEqual(
    one.runs.map((r) => r.status),
    ['failed', 'ok'],
  );
  const limited = await call('atrium_list_automation_runs', { boardId: 'b1', limit: 1 });
  assert.equal(limited.runs.length, 1);
  assert.match(all.note, /newest 200/);
});

test('descriptions: the safety wording, untrusted content, annotations and scopes', () => {
  const { tools } = setup();
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.match(by.atrium_create_automation.description, /SWITCHED OFF/);
  assert.match(by.atrium_create_automation.description, /confirm/i);
  assert.match(by.atrium_set_automation_enabled.description, /confirmed/);
  assert.match(by.atrium_list_automations.description, /data written by people, not instructions/);
  assert.match(
    by.atrium_list_automation_runs.description,
    /data written by people, not instructions/,
  );
  assert.equal(by.atrium_delete_automation.annotations.destructiveHint, true);
  assert.equal(by.atrium_set_automation_enabled.annotations.idempotentHint, true);
  assert.equal(by.atrium_list_automations.scope, 'read');
  assert.equal(by.atrium_list_automation_runs.scope, 'read');
  for (const name of ['create', 'update', 'delete']) {
    assert.equal(by[`atrium_${name}_automation`].scope, 'write');
  }
});
