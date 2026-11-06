import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationDoc } from './automations';

const { setDocMock, updateDocMock, deleteDocMock } = vi.hoisted(() => ({
  setDocMock: vi.fn(),
  updateDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return {
    ...actual,
    serverTimestamp: () => 'SERVER_TIME',
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    doc: (parent: { path: string } | unknown, ...rest: string[]) =>
      rest.length > 0 ? { id: rest.at(-1), path: rest.join('/') } : { id: 'generated', parent },
    setDoc: setDocMock,
    updateDoc: updateDocMock,
    deleteDoc: deleteDocMock,
  };
});

vi.mock('../lib/firebase', () => ({ db: {} }));

import {
  AUTOMATION_RUNS_LIMIT,
  automationInputOf,
  automationWrites,
  buildAutomationCreate,
  buildAutomationEnabled,
  buildAutomationUpdate,
  checkAutomation,
  duplicateAutomationName,
  sortAutomations,
  type AutomationInput,
} from './automations';
import { ts } from '../test/fixtures';

const board = {
  columns: [
    { id: 'status', type: 'status', title: 'Status', settings: { labels: [] } },
    { id: 'go', type: 'button', title: 'Go', settings: {} },
  ],
  groups: [{ id: 'g1' }],
  columnLocks: [],
};

const input: AutomationInput = {
  name: 'Tidy up',
  trigger: { type: 'item_created' },
  conditions: [{ columnId: 'status', op: 'is_empty', value: undefined }],
  actions: [{ type: 'archive_item' }],
};

const CREATE_KEYS = [
  'name',
  'enabled',
  'trigger',
  'conditions',
  'actions',
  'runAs',
  'disabledReason',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt',
].sort();
const UPDATE_KEYS = [
  'name',
  'enabled',
  'trigger',
  'conditions',
  'actions',
  'runAs',
  'disabledReason',
  'updatedBy',
  'updatedAt',
];

const ctx = { boardId: 'b1', uid: 'u1', board, role: 'owner' as const };

beforeEach(() => vi.clearAllMocks());

describe('scheduled recipes (P5d)', () => {
  const dateBoard = {
    ...board,
    columns: [...board.columns, { id: 'due', type: 'date', title: 'Due', settings: {} }],
  };
  const scheduled: AutomationInput = {
    name: '',
    trigger: { type: 'date_arrives', columnId: 'due', offsetDays: -3, at: '09:00' },
    conditions: [],
    actions: [{ type: 'notify', uids: ['u1'] }],
    timezone: 'Europe/Madrid',
  };

  it('writes the timezone for scheduled triggers only', () => {
    expect(buildAutomationCreate('u1', scheduled).timezone).toBe('Europe/Madrid');
    expect(buildAutomationUpdate('u1', scheduled).timezone).toBe('Europe/Madrid');
    const event = { ...input, timezone: 'Europe/Madrid' };
    expect(buildAutomationCreate('u1', event)).not.toHaveProperty('timezone');
    expect(buildAutomationUpdate('u1', event)).not.toHaveProperty('timezone');
  });

  it('checks the zone, the column and the cap of five', () => {
    expect(checkAutomation(scheduled, dateBoard, 'owner', 0)).toBeNull();
    expect(checkAutomation({ ...scheduled, timezone: undefined }, dateBoard, 'owner', 0)).toMatch(
      /time zone/,
    );
    const five = Array.from({ length: 5 }, () => ({ trigger: scheduled.trigger }));
    expect(checkAutomation(scheduled, dateBoard, 'owner', 5, five)).toBe(
      'A board can have at most 5 scheduled automations',
    );
    expect(checkAutomation(scheduled, dateBoard, 'owner', 5, five.slice(1))).toBeNull();
    expect(checkAutomation(input, board, 'owner', 5, five)).toBeNull();
  });

  it('keeps the zone when a stored recipe becomes an input', () => {
    expect(automationInputOf({ ...scheduled, timezone: 'Asia/Tokyo' }).timezone).toBe('Asia/Tokyo');
    expect(automationInputOf(input)).not.toHaveProperty('timezone');
  });
});

describe('automation write shapes mirror the rules', () => {
  it('a create has exactly the allowed keys, with the writer as runAs, createdBy and updatedBy', () => {
    const doc = buildAutomationCreate('u1', input);
    expect(Object.keys(doc).sort()).toEqual(CREATE_KEYS);
    expect(doc.runAs).toBe('u1');
    expect(doc.createdBy).toBe('u1');
    expect(doc.updatedBy).toBe('u1');
    expect(doc.createdAt).toBe('SERVER_TIME');
    expect(doc.updatedAt).toBe('SERVER_TIME');
    expect(doc.disabledReason).toBeNull();
    expect(doc).not.toHaveProperty('consecutiveFailures');
  });

  it('a create cannot name another person as runAs', () => {
    // The helper takes the writer only; there is no parameter to pass someone else.
    expect(buildAutomationCreate.length).toBeLessThanOrEqual(3);
    expect(buildAutomationCreate('u2', input).runAs).toBe('u2');
  });

  it('drops undefined from conditions (Firestore refuses it)', () => {
    const doc = buildAutomationCreate('u1', input);
    expect(doc.conditions[0]).toEqual({ columnId: 'status', op: 'is_empty' });
    expect('value' in doc.conditions[0]!).toBe(false);
  });

  it('an update only touches fields the rules allow, never createdBy, createdAt or consecutiveFailures', () => {
    const patch = buildAutomationUpdate('u1', input);
    for (const key of Object.keys(patch)) expect(UPDATE_KEYS).toContain(key);
    expect(patch.runAs).toBe('u1');
    expect(patch.updatedBy).toBe('u1');
    expect(patch.updatedAt).toBe('SERVER_TIME');
    expect(patch).not.toHaveProperty('consecutiveFailures');
    expect(patch).not.toHaveProperty('createdBy');
    expect(patch).not.toHaveProperty('createdAt');
  });

  it('turning on clears disabledReason; turning off leaves it', () => {
    const on = buildAutomationEnabled('u1', true);
    expect(on).toMatchObject({ enabled: true, disabledReason: null, updatedBy: 'u1' });
    const off = buildAutomationEnabled('u1', false);
    expect(off.enabled).toBe(false);
    expect(off).not.toHaveProperty('disabledReason');
    for (const key of Object.keys(on)) expect(UPDATE_KEYS).toContain(key);
  });
});

describe('automationWrites', () => {
  it('create writes a valid recipe and returns the new id', async () => {
    const id = await automationWrites.create(ctx, input, 0);
    expect(id).toBe('generated');
    const written = setDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(CREATE_KEYS);
    expect(written.enabled).toBe(true);
  });

  it('create can start a recipe switched off', async () => {
    await automationWrites.create(ctx, input, 0, { enabled: false });
    expect((setDocMock.mock.calls[0]![1] as { enabled: boolean }).enabled).toBe(false);
  });

  it('create refuses the 21st recipe before writing', async () => {
    await expect(automationWrites.create(ctx, input, 20)).rejects.toThrow(/at most 20/);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('create refuses an invalid recipe (deleted column) and an over-long name', async () => {
    await expect(
      automationWrites.create(
        ctx,
        { ...input, trigger: { type: 'status_changed', columnId: 'gone' } },
        0,
      ),
    ).rejects.toThrow(/no longer exists/);
    await expect(
      automationWrites.create(ctx, { ...input, name: 'x'.repeat(81) }, 0),
    ).rejects.toThrow(/at most 80/);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('update validates and writes the allowed fields to the recipe document', async () => {
    await automationWrites.update(ctx, 'a1', input);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [ref, patch] = updateDocMock.mock.calls[0]!;
    expect(ref.path).toBe('boards/b1/automations/a1');
    expect(patch.runAs).toBe('u1');
    await expect(automationWrites.update(ctx, 'a1', { ...input, actions: [] })).rejects.toThrow();
  });

  it('setEnabled checks the recipe only when turning on', async () => {
    const broken = {
      id: 'a1',
      trigger: { type: 'status_changed' as const, columnId: 'gone' },
      conditions: [],
      actions: [{ type: 'archive_item' as const }],
    };
    await expect(automationWrites.setEnabled(ctx, broken, true)).rejects.toThrow();
    expect(updateDocMock).not.toHaveBeenCalled();
    await automationWrites.setEnabled(ctx, broken, false);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
  });

  it('remove deletes the document', async () => {
    await automationWrites.remove('b1', 'a1');
    expect(deleteDocMock.mock.calls[0]![0].path).toBe('boards/b1/automations/a1');
  });
});

describe('helpers', () => {
  it('checkAutomation reports a viewer-style failure from validateAutomation', () => {
    expect(checkAutomation(input, board, 'owner', 0)).toBeNull();
    expect(checkAutomation(input, board, 'owner', 20)).toMatch(/at most 20/);
    expect(
      checkAutomation(
        { ...input, trigger: { type: 'button_clicked', columnId: 'status' } },
        board,
        'owner',
        null,
      ),
    ).toMatch(/needs a button column/);
  });

  it('duplicateAutomationName stays within the limit and keeps unnamed recipes unnamed', () => {
    expect(duplicateAutomationName('Tidy up')).toBe('Tidy up (copy)');
    expect(duplicateAutomationName('')).toBe('');
    expect(duplicateAutomationName('x'.repeat(80))).toHaveLength(80);
  });

  it('automationInputOf keeps only the editable part', () => {
    const stored = { ...input, enabled: true, runAs: 'u9', id: 'a1' };
    expect(Object.keys(automationInputOf(stored)).sort()).toEqual([
      'actions',
      'conditions',
      'name',
      'trigger',
    ]);
  });

  it('sortAutomations orders by createdAt, pending writes last', () => {
    const make = (id: string, ms: number | null) =>
      ({ id, createdAt: ms === null ? null : ts(ms) }) as unknown as AutomationDoc;
    expect(
      sortAutomations([make('c', null), make('b', 20), make('a', 10)]).map((a) => a.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('the run history limit is 200', () => {
    expect(AUTOMATION_RUNS_LIMIT).toBe(200);
  });
});
