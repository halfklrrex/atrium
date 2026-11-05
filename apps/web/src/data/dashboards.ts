/**
 * Dashboards data layer (P6): converter, refs, queries, writes and hooks for `dashboards/{id}`.
 * Kept in its own file (not `firestore.ts`) so the shared Firestore module stays untouched; the
 * rules for the collection are in `firestore.rules`.
 *
 * A dashboard stores no item data. Widgets read live from the boards (`dashboard-items.ts`), each
 * under that board's own read rules.
 */
import {
  DASHBOARD_LIMITS,
  createDashboardInputSchema,
  dashboardWidgetsSchema,
  defaultWidgetSettings,
  type BoardKind,
  type BoardRole,
  type CreateDashboardInput,
  type Dashboard,
  type DashboardState,
  type DashboardWidget,
  type DashboardWidgetType,
} from '@atrium/shared';
import {
  collection,
  doc,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type FirestoreDataConverter,
  type Query,
} from 'firebase/firestore';
import { useMemo } from 'react';
import { newSlugId } from '../lib/ids';
import { db } from '../lib/firebase';
import { comparePositions } from '../lib/positions';
import {
  newWidgetLayout,
  normalizeWidgets,
  toGridItems,
} from '../components/dashboard/dashboard-layout';
import { requireUid } from './firestore';
import type { DashboardDoc } from './model';
import { useDocSnapshot, useQuerySnapshot, type SnapshotState } from './useSnapshot';

const COLLECTION = 'dashboards';

const dashboardConverter: FirestoreDataConverter<DashboardDoc, DocumentData> = {
  toFirestore: ({ id: _id, ...data }) => data as DocumentData,
  fromFirestore: (snapshot, options) =>
    ({
      ...(snapshot.data({ ...options, serverTimestamps: 'estimate' }) as Dashboard),
      id: snapshot.id,
    }) as DashboardDoc,
};

export const dashboardRefs = {
  dashboards: (): CollectionReference<DashboardDoc> =>
    collection(db, COLLECTION).withConverter(dashboardConverter),
  dashboard: (dashboardId: string): DocumentReference<DashboardDoc> =>
    doc(db, COLLECTION, dashboardId).withConverter(dashboardConverter),
};

export const dashboardQueries = {
  /** Listing half 1: main dashboards of a workspace (visible to every member). */
  mainInWorkspace: (workspaceId: string): Query<DashboardDoc> =>
    query(
      dashboardRefs.dashboards(),
      where('workspaceId', '==', workspaceId),
      where('kind', '==', 'main'),
    ),

  /** Listing half 2: dashboards of a workspace that list the user in `accessUids`. */
  mineInWorkspace: (workspaceId: string, uid: string): Query<DashboardDoc> =>
    query(
      dashboardRefs.dashboards(),
      where('workspaceId', '==', workspaceId),
      where('accessUids', 'array-contains', uid),
    ),
};

// ---- Pure helpers (unit tested) ----

/** Union of listings by id, in position order. */
export function mergeDashboards(...lists: readonly (readonly DashboardDoc[])[]): DashboardDoc[] {
  const byId = new Map<string, DashboardDoc>();
  for (const list of lists) for (const dashboard of list) byId.set(dashboard.id, dashboard);
  return [...byId.values()].sort(comparePositions);
}

/** Dashboards in the workspace trash. */
export function deletedDashboards(dashboards: readonly DashboardDoc[]): DashboardDoc[] {
  return dashboards.filter((d) => d.state === 'deleted');
}

/** Dashboards that show up in lists: trashed ones are hidden. */
export function activeDashboards(dashboards: readonly DashboardDoc[]): DashboardDoc[] {
  return dashboards.filter((d) => d.state === 'active');
}

/** Drops board ids that are no longer on the dashboard from each widget's own board list. */
export function pruneWidgetBoards(
  widgets: readonly DashboardWidget[],
  boardIds: readonly string[],
): DashboardWidget[] {
  const allowed = new Set(boardIds);
  return widgets.map((w) =>
    w.boardIds.every((id) => allowed.has(id))
      ? w
      : ({ ...w, boardIds: w.boardIds.filter((id) => allowed.has(id)) } as DashboardWidget),
  );
}

/** Throws a readable error when the widgets are invalid or point outside the dashboard's boards. */
export function assertValidWidgets(
  widgets: readonly DashboardWidget[],
  boardIds: readonly string[],
): DashboardWidget[] {
  const parsed = dashboardWidgetsSchema.parse(widgets);
  const allowed = new Set(boardIds);
  if (parsed.some((w) => w.boardIds.some((id) => !allowed.has(id)))) {
    throw new Error('A widget can only read boards that are on the dashboard.');
  }
  return parsed;
}

/** A new widget of `type` in the first free slot of the grid. */
export function buildWidget(
  existing: readonly DashboardWidget[],
  input: {
    type: DashboardWidgetType;
    title: string;
    boardIds?: string[];
    settings?: DashboardWidget['settings'];
  },
): DashboardWidget {
  return {
    id: newSlugId(),
    type: input.type,
    title: input.title,
    layout: newWidgetLayout(toGridItems(existing), input.type),
    boardIds: input.boardIds ?? [],
    settings: input.settings ?? defaultWidgetSettings(input.type),
  } as DashboardWidget;
}

// ---- Writes ----

/** Fields the UI may change through `updateDashboard` (a subset of what the rules allow). */
export interface DashboardPatch {
  name?: string;
  icon?: string | null;
  folderId?: string | null;
  position?: string;
}

/** A sharing change: a new kind, and/or one person's role (`null` removes them). */
export interface DashboardSharingChange {
  kind?: BoardKind;
  person?: { uid: string; role: BoardRole | null };
}

const OWNER_REQUIRED = 'A dashboard needs at least one owner. Make someone else an owner first.';

/**
 * The `kind` and `access` after a sharing change, by the owner `callerUid`. Pure. The caller
 * always stays an owner (they are added as owner when a main dashboard becomes private or
 * shareable), the last explicit owner of a private or shareable dashboard cannot be removed or
 * demoted, and the map keeps to the rules' size limit.
 */
export function applyDashboardSharing(
  current: Pick<Dashboard, 'kind' | 'access'>,
  change: DashboardSharingChange,
  callerUid: string,
): { kind: BoardKind; access: Record<string, BoardRole> } {
  const kind = change.kind ?? current.kind;
  const access = { ...current.access };
  const target = change.person;
  if (target && target.uid === callerUid && target.role !== 'owner') {
    const others = Object.entries(access).some(([id, r]) => id !== callerUid && r === 'owner');
    throw new Error(
      others ? "You can't remove or demote yourself here. Ask another owner." : OWNER_REQUIRED,
    );
  }
  if (target) {
    if (target.role) access[target.uid] = target.role;
    else delete access[target.uid];
  }
  // The rules want the caller listed as owner whenever sharing changes.
  access[callerUid] = 'owner';
  if (Object.keys(access).length > DASHBOARD_LIMITS.accessEntries) {
    throw new Error(`A dashboard can list at most ${DASHBOARD_LIMITS.accessEntries} people.`);
  }
  return { kind, access };
}

const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: requireUid() });

/**
 * Reads the dashboard in a transaction, lets `change` produce its next `widgets` (and optionally
 * `boardIds`), validates the result and writes both. Concurrent edits from two tabs therefore never
 * overwrite each other's widgets.
 */
async function transformDashboard(
  dashboardId: string,
  change: (current: DashboardDoc) => { widgets: DashboardWidget[]; boardIds?: string[] },
): Promise<void> {
  const ref = dashboardRefs.dashboard(dashboardId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This dashboard no longer exists.');
    const current = snap.data();
    const next = change(current);
    const boardIds = next.boardIds ?? current.boardIds;
    const widgets = assertValidWidgets(next.widgets, boardIds);
    tx.update(ref, {
      widgets,
      ...(next.boardIds ? { boardIds: next.boardIds } : {}),
      ...stamp(),
    });
  });
}

export const dashboardWrites = {
  /** Create a dashboard with the caller as its sole owner (the only create the rules permit). */
  async createDashboard(
    uid: string,
    workspaceId: string,
    input: CreateDashboardInput,
    position: string,
  ): Promise<string> {
    const form = createDashboardInputSchema.parse(input);
    const created = doc(collection(db, COLLECTION));
    await setDoc(created, {
      workspaceId,
      folderId: form.folderId,
      name: form.name,
      kind: form.kind,
      access: { [uid]: 'owner' },
      accessUids: [uid],
      position,
      icon: null,
      boardIds: form.boardIds,
      widgets: [],
      state: 'active',
      deletedAt: null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
    });
    return created.id;
  },

  /** Rename, re-icon or move (folder, position). */
  async updateDashboard(dashboardId: string, patch: DashboardPatch): Promise<void> {
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length < 1 || name.length > DASHBOARD_LIMITS.name) {
        throw new Error(`Name must be 1 to ${DASHBOARD_LIMITS.name} characters.`);
      }
      patch = { ...patch, name };
    }
    await updateDoc(dashboardRefs.dashboard(dashboardId), { ...patch, ...stamp() });
  },

  /** Trash / restore. Only dashboard owners may do this (rules). */
  async setDashboardState(dashboardId: string, state: DashboardState): Promise<void> {
    await updateDoc(dashboardRefs.dashboard(dashboardId), {
      state,
      deletedAt: state === 'deleted' ? serverTimestamp() : null,
      ...stamp(),
    });
  },

  /** Change the kind and/or one person's role. Dashboard owners only (rules); see `applyDashboardSharing`. */
  async setDashboardSharing(dashboardId: string, change: DashboardSharingChange): Promise<void> {
    const callerUid = requireUid();
    const ref = dashboardRefs.dashboard(dashboardId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('This dashboard no longer exists.');
      const next = applyDashboardSharing(snap.data(), change, callerUid);
      tx.update(ref, { ...next, accessUids: Object.keys(next.access), ...stamp() });
    });
  },

  /**
   * Set the boards the dashboard reads from (at most 50, unique). Widgets that named a board that
   * was removed lose that entry in the same transaction.
   */
  async setDashboardBoards(dashboardId: string, boardIds: readonly string[]): Promise<void> {
    const unique = [...new Set(boardIds)];
    if (unique.length > DASHBOARD_LIMITS.boards) {
      throw new Error(`A dashboard can read at most ${DASHBOARD_LIMITS.boards} boards.`);
    }
    await transformDashboard(dashboardId, (current) => ({
      boardIds: unique,
      widgets: pruneWidgetBoards(current.widgets, unique),
    }));
  },

  /** Add a widget in the first free slot; returns its id. */
  async addWidget(
    dashboardId: string,
    input: {
      type: DashboardWidgetType;
      title: string;
      boardIds?: string[];
      settings?: DashboardWidget['settings'];
    },
  ): Promise<string> {
    let id = '';
    await transformDashboard(dashboardId, (current) => {
      if (current.widgets.length >= DASHBOARD_LIMITS.widgets) {
        throw new Error(`A dashboard can hold at most ${DASHBOARD_LIMITS.widgets} widgets.`);
      }
      const widget = buildWidget(current.widgets, input);
      id = widget.id;
      return { widgets: [...current.widgets, widget] };
    });
    return id;
  },

  /** Change a widget's title, boards or settings. The type and layout are not touched. */
  async updateWidget(
    dashboardId: string,
    widgetId: string,
    patch: Partial<Pick<DashboardWidget, 'title' | 'boardIds' | 'settings'>>,
  ): Promise<void> {
    await transformDashboard(dashboardId, (current) => ({
      widgets: current.widgets.map((w) =>
        w.id === widgetId ? ({ ...w, ...patch } as DashboardWidget) : w,
      ),
    }));
  },

  /** Copy a widget (right after the originals, in the first free slot). Returns the new id. */
  async duplicateWidget(dashboardId: string, widgetId: string): Promise<string> {
    let id = '';
    await transformDashboard(dashboardId, (current) => {
      const source = current.widgets.find((w) => w.id === widgetId);
      if (!source) throw new Error('This widget no longer exists.');
      if (current.widgets.length >= DASHBOARD_LIMITS.widgets) {
        throw new Error(`A dashboard can hold at most ${DASHBOARD_LIMITS.widgets} widgets.`);
      }
      id = newSlugId();
      const copy = {
        ...structuredClone(source),
        id,
        title: `${source.title} copy`.slice(0, DASHBOARD_LIMITS.widgetTitle),
        layout: {
          ...newWidgetLayout(toGridItems(current.widgets), source.type),
          w: source.layout.w,
          h: source.layout.h,
        },
      } as DashboardWidget;
      return { widgets: normalizeWidgets([...current.widgets, copy]) };
    });
    return id;
  },

  async removeWidget(dashboardId: string, widgetId: string): Promise<void> {
    await transformDashboard(dashboardId, (current) => ({
      widgets: normalizeWidgets(current.widgets.filter((w) => w.id !== widgetId)),
    }));
  },

  /** Persist new grid positions after a drag, resize or keyboard move. */
  async setWidgetLayouts(
    dashboardId: string,
    layouts: readonly { id: string; x: number; y: number; w: number; h: number }[],
  ): Promise<void> {
    const byId = new Map(layouts.map((l) => [l.id, l]));
    await transformDashboard(dashboardId, (current) => ({
      widgets: normalizeWidgets(
        current.widgets.map((w) => {
          const l = byId.get(w.id);
          return l ? ({ ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } as DashboardWidget) : w;
        }),
      ),
    }));
  },
};

// ---- Hooks ----

/** One dashboard (live); `data` is `null` while missing or not readable. */
export function useDashboard(dashboardId: string | undefined): SnapshotState<DashboardDoc | null> {
  const ref = useMemo(
    () => (dashboardId ? dashboardRefs.dashboard(dashboardId) : null),
    [dashboardId],
  );
  return useDocSnapshot(ref);
}

/**
 * Active dashboards of a workspace the user can see: the "main" listener and the "I have explicit
 * access" listener, merged by id.
 */
export function useWorkspaceDashboards(
  workspaceId: string | undefined,
  uid: string | null,
): SnapshotState<DashboardDoc[]> {
  const mainQuery = useMemo(
    () => (workspaceId && uid ? dashboardQueries.mainInWorkspace(workspaceId) : null),
    [workspaceId, uid],
  );
  const mineQuery = useMemo(
    () => (workspaceId && uid ? dashboardQueries.mineInWorkspace(workspaceId, uid) : null),
    [workspaceId, uid],
  );
  const main = useQuerySnapshot(mainQuery);
  const mine = useQuerySnapshot(mineQuery);
  const data = useMemo(
    () => activeDashboards(mergeDashboards(main.data, mine.data)),
    [main.data, mine.data],
  );
  return { data, loading: main.loading || mine.loading, error: main.error ?? mine.error };
}

/** All dashboards of a workspace the user can see, trashed ones included (the Trash page). */
export function useAllWorkspaceDashboards(
  workspaceId: string | undefined,
  uid: string | null,
): SnapshotState<DashboardDoc[]> {
  const mainQuery = useMemo(
    () => (workspaceId && uid ? dashboardQueries.mainInWorkspace(workspaceId) : null),
    [workspaceId, uid],
  );
  const mineQuery = useMemo(
    () => (workspaceId && uid ? dashboardQueries.mineInWorkspace(workspaceId, uid) : null),
    [workspaceId, uid],
  );
  const main = useQuerySnapshot(mainQuery);
  const mine = useQuerySnapshot(mineQuery);
  const data = useMemo(() => mergeDashboards(main.data, mine.data), [main.data, mine.data]);
  return { data, loading: main.loading || mine.loading, error: main.error ?? mine.error };
}
