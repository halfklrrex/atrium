import type { DashboardWidget } from '@atrium/shared';
import { defaultWidgetSettings } from '@atrium/shared';
import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ts } from '../test/fixtures';

const m = vi.hoisted(() => ({
  setDoc: vi.fn(),
  update: vi.fn(),
  txUpdate: vi.fn(),
  txGet: vi.fn(),
  ids: 0,
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return {
    ...actual,
    serverTimestamp: () => 'SERVER_TIME',
    collection: (_db: unknown, ...segments: string[]) => {
      const ref = { path: segments.join('/'), withConverter: () => ref };
      return ref;
    },
    doc: (parent: { path: string } | unknown, ...segments: string[]) => {
      const base = (parent as { path?: string }).path;
      const id = segments.length > 0 ? segments.join('/') : `gen${++m.ids}`;
      const ref = {
        id: segments.at(-1) ?? id,
        path: base && segments.length === 0 ? `${base}/${id}` : id,
        withConverter: () => ref,
      };
      return ref;
    },
    query: (ref: unknown) => ref,
    where: () => ({}),
    setDoc: m.setDoc,
    updateDoc: m.update,
    runTransaction: (_db: unknown, fn: (tx: unknown) => Promise<void>) =>
      fn({ get: m.txGet, update: m.txUpdate }),
  };
});
vi.mock('../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

import {
  activeDashboards,
  applyDashboardSharing,
  deletedDashboards,
  assertValidWidgets,
  buildWidget,
  dashboardWrites,
  mergeDashboards,
  pruneWidgetBoards,
} from './dashboards';
import type { DashboardDoc } from './model';

const widget = (id: string, overrides: Partial<DashboardWidget> = {}): DashboardWidget =>
  ({
    id,
    type: 'numbers',
    title: id,
    layout: { x: 0, y: 0, w: 3, h: 3 },
    boardIds: [],
    settings: defaultWidgetSettings('numbers'),
    ...overrides,
  }) as DashboardWidget;

const dashboard = (overrides: Partial<DashboardDoc> & { id: string }): DashboardDoc => ({
  workspaceId: 'w1',
  folderId: null,
  name: overrides.id,
  kind: 'main',
  access: { u1: 'owner' },
  accessUids: ['u1'],
  position: 'a0',
  icon: null,
  boardIds: ['b1', 'b2'],
  widgets: [],
  state: 'active',
  deletedAt: null,
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
  ...overrides,
});

/** The next transaction reads this dashboard. */
const reads = (d: DashboardDoc | null) =>
  m.txGet.mockResolvedValue({ exists: () => d !== null, data: () => d });

beforeEach(() => {
  vi.clearAllMocks();
  m.ids = 0;
  m.setDoc.mockResolvedValue(undefined);
  m.update.mockResolvedValue(undefined);
  m.txUpdate.mockReturnValue(undefined);
});

describe('pure helpers', () => {
  it('merges listings by id in position order and hides trashed dashboards', () => {
    const a = dashboard({ id: 'a', position: 'a1' });
    const b = dashboard({ id: 'b', position: 'a0' });
    const trashed = dashboard({ id: 'c', position: 'a2', state: 'deleted' });
    const merged = mergeDashboards([a, b], [a, trashed]);
    expect(merged.map((d) => d.id)).toEqual(['b', 'a', 'c']);
    expect(activeDashboards(merged).map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('prunes widget boards that left the dashboard', () => {
    const kept = widget('k', { boardIds: ['b1'] });
    const cut = widget('c', { boardIds: ['b1', 'b9'] });
    const out = pruneWidgetBoards([kept, cut], ['b1']);
    expect(out[0]).toBe(kept);
    expect(out[1]?.boardIds).toEqual(['b1']);
  });

  it('validates widgets and their boards', () => {
    expect(assertValidWidgets([widget('a', { boardIds: ['b1'] })], ['b1'])).toHaveLength(1);
    expect(() => assertValidWidgets([widget('a', { boardIds: ['zz'] })], ['b1'])).toThrow(
      /on the dashboard/,
    );
    expect(() => assertValidWidgets([widget('a'), widget('a')], [])).toThrow();
  });

  it('builds a widget in the first free slot with default settings', () => {
    const first = buildWidget([], { type: 'battery', title: 'Progress' });
    expect(first).toMatchObject({ type: 'battery', title: 'Progress', boardIds: [] });
    expect(first.layout).toEqual({ x: 0, y: 0, w: 6, h: 3 });
    expect(first.settings).toEqual(defaultWidgetSettings('battery'));
    const second = buildWidget([first], { type: 'battery', title: 'Two' });
    expect(second.layout).toMatchObject({ x: 6, y: 0 });
    expect(second.id).not.toBe(first.id);
  });
});

describe('createDashboard', () => {
  it('creates with the caller as sole owner and no widgets', async () => {
    const id = await dashboardWrites.createDashboard(
      'u1',
      'w1',
      { name: ' Plan ', boardIds: ['b1'] },
      'a5',
    );
    expect(id).toBeTruthy();
    const [, data] = m.setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(data).toEqual({
      workspaceId: 'w1',
      folderId: null,
      name: 'Plan',
      kind: 'main',
      access: { u1: 'owner' },
      accessUids: ['u1'],
      position: 'a5',
      icon: null,
      boardIds: ['b1'],
      widgets: [],
      state: 'active',
      deletedAt: null,
      createdAt: 'SERVER_TIME',
      createdBy: 'u1',
      updatedAt: 'SERVER_TIME',
    });
  });

  it('honours kind and folder, and rejects an empty name', async () => {
    await dashboardWrites.createDashboard(
      'u1',
      'w1',
      { name: 'P', kind: 'private', folderId: 'f1' },
      'a0',
    );
    expect(m.setDoc.mock.calls[0]?.[1]).toMatchObject({ kind: 'private', folderId: 'f1' });
    await expect(
      dashboardWrites.createDashboard('u1', 'w1', { name: ' ' }, 'a0'),
    ).rejects.toThrow();
    expect(m.setDoc).toHaveBeenCalledTimes(1);
  });
});

describe('updateDashboard and state', () => {
  it('stamps updatedAt and updatedBy', async () => {
    await dashboardWrites.updateDashboard('d1', { name: ' New ', position: 'a3' });
    expect(m.update.mock.calls[0]?.[1]).toEqual({
      name: 'New',
      position: 'a3',
      updatedAt: 'SERVER_TIME',
      updatedBy: 'u1',
    });
  });

  it('refuses a bad name before writing', async () => {
    await expect(dashboardWrites.updateDashboard('d1', { name: '' })).rejects.toThrow();
    await expect(dashboardWrites.updateDashboard('d1', { name: 'x'.repeat(81) })).rejects.toThrow();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('trashes and restores with deletedAt', async () => {
    await dashboardWrites.setDashboardState('d1', 'deleted');
    expect(m.update.mock.calls[0]?.[1]).toMatchObject({
      state: 'deleted',
      deletedAt: 'SERVER_TIME',
    });
    await dashboardWrites.setDashboardState('d1', 'active');
    expect(m.update.mock.calls[1]?.[1]).toMatchObject({ state: 'active', deletedAt: null });
  });
});

describe('widget writes (transactions)', () => {
  it('adds a widget in the first free slot', async () => {
    reads(dashboard({ id: 'd1', widgets: [widget('w1')] }));
    const id = await dashboardWrites.addWidget('d1', { type: 'numbers', title: 'Count' });
    const [, patch] = m.txUpdate.mock.calls[0] as [unknown, { widgets: DashboardWidget[] }];
    expect(patch.widgets).toHaveLength(2);
    expect(patch.widgets[1]).toMatchObject({ id, type: 'numbers', title: 'Count' });
    expect(patch.widgets[1]?.layout).toEqual({ x: 3, y: 0, w: 3, h: 3 });
    expect(patch).toMatchObject({ updatedAt: 'SERVER_TIME', updatedBy: 'u1' });
  });

  it('refuses a 25th widget and a missing dashboard', async () => {
    const full = Array.from({ length: 24 }, (_, i) =>
      widget(`w${i}`, { layout: { x: (i % 4) * 3, y: Math.floor(i / 4) * 3, w: 3, h: 3 } }),
    );
    reads(dashboard({ id: 'd1', widgets: full }));
    await expect(dashboardWrites.addWidget('d1', { type: 'numbers', title: 'X' })).rejects.toThrow(
      /at most 24/,
    );
    reads(null);
    await expect(dashboardWrites.addWidget('d1', { type: 'numbers', title: 'X' })).rejects.toThrow(
      /no longer exists/,
    );
    expect(m.txUpdate).not.toHaveBeenCalled();
  });

  it('refuses a widget that names a board outside the dashboard', async () => {
    reads(dashboard({ id: 'd1' }));
    await expect(
      dashboardWrites.addWidget('d1', { type: 'numbers', title: 'X', boardIds: ['zz'] }),
    ).rejects.toThrow(/on the dashboard/);
    expect(m.txUpdate).not.toHaveBeenCalled();
  });

  it('updates one widget and leaves the rest', async () => {
    const a = widget('a');
    const b = widget('b', { layout: { x: 3, y: 0, w: 3, h: 3 } });
    reads(dashboard({ id: 'd1', widgets: [a, b] }));
    await dashboardWrites.updateWidget('d1', 'b', { title: 'Renamed', boardIds: ['b2'] });
    const widgets = (m.txUpdate.mock.calls[0]?.[1] as { widgets: DashboardWidget[] }).widgets;
    expect(widgets[0]).toEqual(a);
    expect(widgets[1]).toMatchObject({ id: 'b', title: 'Renamed', boardIds: ['b2'] });
  });

  it('removes a widget and compacts the grid', async () => {
    reads(
      dashboard({
        id: 'd1',
        widgets: [widget('a'), widget('b', { layout: { x: 0, y: 3, w: 3, h: 3 } })],
      }),
    );
    await dashboardWrites.removeWidget('d1', 'a');
    const widgets = (m.txUpdate.mock.calls[0]?.[1] as { widgets: DashboardWidget[] }).widgets;
    expect(widgets.map((w) => w.id)).toEqual(['b']);
    expect(widgets[0]?.layout.y).toBe(0);
  });

  it('duplicates a widget with a new id and the same size', async () => {
    reads(dashboard({ id: 'd1', widgets: [widget('a', { title: 'Count' })] }));
    const id = await dashboardWrites.duplicateWidget('d1', 'a');
    const widgets = (m.txUpdate.mock.calls[0]?.[1] as { widgets: DashboardWidget[] }).widgets;
    expect(widgets).toHaveLength(2);
    expect(widgets[1]).toMatchObject({ id, title: 'Count copy', type: 'numbers' });
    expect(widgets[1]?.layout).toMatchObject({ w: 3, h: 3 });
  });

  it('writes new layouts, resolving collisions', async () => {
    reads(
      dashboard({
        id: 'd1',
        widgets: [widget('a'), widget('b', { layout: { x: 3, y: 0, w: 3, h: 3 } })],
      }),
    );
    await dashboardWrites.setWidgetLayouts('d1', [{ id: 'b', x: 0, y: 0, w: 3, h: 3 }]);
    const widgets = (m.txUpdate.mock.calls[0]?.[1] as { widgets: DashboardWidget[] }).widgets;
    const [a, b] = widgets;
    expect(a?.layout.y === 3 || b?.layout.y === 3).toBe(true);
  });

  it('sets the boards, prunes widgets and refuses more than 50', async () => {
    reads(dashboard({ id: 'd1', widgets: [widget('a', { boardIds: ['b1', 'b2'] })] }));
    await dashboardWrites.setDashboardBoards('d1', ['b1', 'b1', 'b3']);
    const patch = m.txUpdate.mock.calls[0]?.[1] as {
      boardIds: string[];
      widgets: DashboardWidget[];
    };
    expect(patch.boardIds).toEqual(['b1', 'b3']);
    expect(patch.widgets[0]?.boardIds).toEqual(['b1']);
    await expect(
      dashboardWrites.setDashboardBoards(
        'd1',
        Array.from({ length: 51 }, (_, i) => `b${i}`),
      ),
    ).rejects.toThrow(/at most 50/);
  });

  it('writes the kind and a person role together with accessUids', async () => {
    reads(dashboard({ id: 'd1', kind: 'private', access: { u1: 'owner' }, accessUids: ['u1'] }));
    await dashboardWrites.setDashboardSharing('d1', { person: { uid: 'u2', role: 'editor' } });
    expect(m.txUpdate.mock.calls[0]?.[1]).toMatchObject({
      kind: 'private',
      access: { u1: 'owner', u2: 'editor' },
      accessUids: ['u1', 'u2'],
    });
  });
});

describe('applyDashboardSharing', () => {
  const priv = { kind: 'private' as const, access: { u1: 'owner', u2: 'viewer' } as const };

  it('adds, changes and removes people', () => {
    const added = applyDashboardSharing(priv, { person: { uid: 'u3', role: 'editor' } }, 'u1');
    expect(added.access).toEqual({ u1: 'owner', u2: 'viewer', u3: 'editor' });
    const removed = applyDashboardSharing(priv, { person: { uid: 'u2', role: null } }, 'u1');
    expect(removed.access).toEqual({ u1: 'owner' });
  });

  it('refuses to remove or demote the last owner of a private dashboard', () => {
    expect(() => applyDashboardSharing(priv, { person: { uid: 'u1', role: null } }, 'u1')).toThrow(
      /at least one owner/,
    );
    expect(() =>
      applyDashboardSharing(priv, { person: { uid: 'u1', role: 'editor' } }, 'u1'),
    ).toThrow(/at least one owner/);
  });

  it('keeps the caller as owner when a main dashboard becomes private', () => {
    const next = applyDashboardSharing({ kind: 'main', access: {} }, { kind: 'private' }, 'u9');
    expect(next).toEqual({ kind: 'private', access: { u9: 'owner' } });
  });

  it('refuses more people than the rules allow', () => {
    const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, 'viewer']));
    expect(() =>
      applyDashboardSharing(
        { kind: 'shareable', access: { u1: 'owner', ...many } },
        { person: { uid: 'new', role: 'viewer' } },
        'u1',
      ),
    ).toThrow(/at most 100/);
  });
});

describe('deletedDashboards', () => {
  it('keeps only trashed dashboards', () => {
    const list = [dashboard({ id: 'a' }), dashboard({ id: 'b', state: 'deleted' })];
    expect(deletedDashboards(list).map((d) => d.id)).toEqual(['b']);
  });
});
