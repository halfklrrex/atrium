import {
  FIRESTORE_DATABASE_ID,
  columnRegistry,
  defaultBoardStructure,
  defaultSubitemColumns,
  type BoardStructure,
  type BoardWrite,
  type ColumnDef,
  type FolderWrite,
  type GroupDef,
  type ItemWrite,
} from '@atrium/shared';
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { adminBootstrapTx } from '../../../functions/src/lib/admin';
import { bootstrapUserInTransaction, type Identity } from '../../../functions/src/lib/bootstrap';
import { FROZEN_TIME, LOCALE, PROJECT_ID, TIMEZONE, useEmulatorEnv } from './env';

useEmulatorEnv();

/**
 * Deterministic fixtures: fixed ids, fixed timestamps (all relative to the frozen "now"), and
 * nothing random, so every run shows the same boards, order and "updated 3 hours ago" labels.
 */
export const AVERY = {
  uid: 'visual-avery',
  email: 'avery@atrium.test',
  password: 'visual-test-password',
  displayName: 'Avery Atrium',
} as const;

export const IDS = {
  personalWorkspace: 'ws-personal',
  familyWorkspace: 'ws-family',
  /** Created on demand by `createEmptyWorkspace`, for the empty-workspace screenshots only. */
  emptyWorkspace: 'ws-empty',
  folder: 'folder-q4',
  roadmap: 'board-roadmap',
  sprint: 'board-sprint',
  notes: 'board-notes',
  trip: 'board-trip',
} as const;

const NOW = new Date(FROZEN_TIME).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A Firestore timestamp `ms` before the frozen "now". */
const ago = (ms: number) => Timestamp.fromMillis(NOW - ms);

function app(): App {
  return (
    getApps().find((a) => a.name === 'visual') ?? initializeApp({ projectId: PROJECT_ID }, 'visual')
  );
}
export const adminDb = (): Firestore => getFirestore(app(), FIRESTORE_DATABASE_ID);

/** Everything the suite writes, so a re-seed starts from a known-empty slate. */
async function clearSeededData(firestore: Firestore): Promise<void> {
  const batch = firestore.batch();
  const ws = (id: string) => firestore.collection('workspaces').doc(id);
  batch.delete(ws(IDS.personalWorkspace).collection('folders').doc(IDS.folder));
  batch.delete(ws(IDS.personalWorkspace));
  batch.delete(ws(IDS.familyWorkspace));
  batch.delete(firestore.collection('users').doc(AVERY.uid));
  await batch.commit();
  // Boards own their items, so they go recursively.
  for (const id of [IDS.roadmap, IDS.sprint, IDS.notes, IDS.trip]) {
    await firestore.recursiveDelete(firestore.collection('boards').doc(id));
  }
  await resetUserState(firestore, { keepUser: false });
}

/**
 * Favourites and recents, plus the user's remembered workspace. Opening boards or workspaces in a
 * test rewrites these (visit times, last workspace), so every test starts from this state again.
 */
export async function resetUserState(
  firestore: Firestore = adminDb(),
  options: { keepUser?: boolean } = {},
): Promise<void> {
  const user = firestore.collection('users').doc(AVERY.uid);
  await firestore.collection('workspaces').doc(IDS.emptyWorkspace).delete();
  for (const name of ['favorites', 'recents']) {
    const stale = await user.collection(name).listDocuments();
    await Promise.all(stale.map((ref) => ref.delete()));
  }
  if (options.keepUser === false) return;

  const batch = firestore.batch();
  batch.update(user, { lastWorkspaceId: IDS.personalWorkspace, theme: 'system' });
  batch.set(user.collection('favorites').doc(IDS.roadmap), {
    boardId: IDS.roadmap,
    workspaceId: IDS.personalWorkspace,
    addedAt: ago(2 * DAY),
    position: 'a0',
  });
  const recents: [string, string, number][] = [
    [IDS.roadmap, IDS.personalWorkspace, HOUR],
    [IDS.notes, IDS.personalWorkspace, 5 * HOUR],
    [IDS.sprint, IDS.personalWorkspace, DAY],
    [IDS.trip, IDS.familyWorkspace, 2 * DAY],
  ];
  for (const [boardId, workspaceId, age] of recents) {
    batch.set(user.collection('recents').doc(boardId), {
      boardId,
      workspaceId,
      visitedAt: ago(age),
    });
  }
  await batch.commit();
}

function board(
  id: string,
  workspaceId: string,
  folderId: string | null,
  name: string,
  position: string,
  updatedAgo: number,
  structure?: BoardStructure,
): BoardWrite {
  let n = 0;
  return {
    workspaceId,
    folderId,
    name,
    description: '',
    kind: 'main',
    access: { [AVERY.uid]: 'owner' },
    accessUids: [AVERY.uid],
    position,
    icon: null,
    ...(structure ?? defaultBoardStructure(() => `${id}-g${++n}`)),
    derivedColumnIds: [],
    serverManagedColumnIds: [],
    state: 'active',
    deletedAt: null,
    createdAt: ago(14 * DAY),
    createdBy: AVERY.uid,
    updatedAt: ago(updatedAgo),
  };
}

/** Creates Avery's Auth account and all Firestore data. Safe to run again on a used emulator. */
export async function seed(): Promise<void> {
  const auth = getAuth(app());
  const firestore = adminDb();

  await auth.deleteUser(AVERY.uid).catch(() => undefined);
  await auth.createUser({
    uid: AVERY.uid,
    email: AVERY.email,
    emailVerified: true,
    password: AVERY.password,
    displayName: AVERY.displayName,
  });

  await clearSeededData(firestore);

  // The user doc and personal workspace come out of the same code `bootstrapUser` runs on sign-in,
  // only with a fixed workspace id and the frozen timestamp instead of a server timestamp.
  const identity: Identity = {
    uid: AVERY.uid,
    displayName: AVERY.displayName,
    email: AVERY.email,
    photoURL: null,
  };
  const createdAt = ago(14 * DAY);
  await firestore.runTransaction((tx) =>
    bootstrapUserInTransaction(
      { ...adminBootstrapTx(firestore, tx), newWorkspaceId: () => IDS.personalWorkspace },
      identity,
      { timezone: TIMEZONE, locale: LOCALE },
      createdAt as never,
    ),
  );

  const personal = firestore.collection('workspaces').doc(IDS.personalWorkspace);
  const family = firestore.collection('workspaces').doc(IDS.familyWorkspace);
  const boards = firestore.collection('boards');

  const folder: FolderWrite = {
    name: 'Q4 planning',
    parentFolderId: null,
    color: '#ffcb00',
    position: 'a0',
    createdAt: ago(10 * DAY),
    createdBy: AVERY.uid,
    updatedAt: ago(3 * DAY),
  };

  const batch = firestore.batch();
  batch.set(family, {
    name: 'Family',
    description: '',
    icon: 'F',
    color: '#00c875',
    ownerId: AVERY.uid,
    memberIds: [AVERY.uid],
    roles: { [AVERY.uid]: 'owner' },
    kind: 'open',
    createdAt: ago(12 * DAY),
    createdBy: AVERY.uid,
    updatedAt: ago(12 * DAY),
  });
  batch.set(personal.collection('folders').doc(IDS.folder), folder);
  batch.set(
    boards.doc(IDS.roadmap),
    board(
      IDS.roadmap,
      IDS.personalWorkspace,
      IDS.folder,
      'Product roadmap',
      'a0',
      3 * HOUR,
      roadmapStructure(),
    ),
  );
  batch.set(
    boards.doc(IDS.sprint),
    board(IDS.sprint, IDS.personalWorkspace, IDS.folder, 'Sprint planning', 'a1', 2 * DAY),
  );
  batch.set(
    boards.doc(IDS.notes),
    board(IDS.notes, IDS.personalWorkspace, null, 'Meeting notes', 'a1', 5 * HOUR),
  );
  batch.set(
    boards.doc(IDS.trip),
    board(IDS.trip, IDS.familyWorkspace, null, 'Summer trip', 'a0', 4 * DAY),
  );
  await batch.commit();
  await seedRoadmapItems(firestore);

  await resetUserState(firestore);
}

// ---------------------------------------------------------------------------------------------
// The table fixture: "Product roadmap" gets the shape of the owner's monday Roadmap board (three
// groups; dropdown, long text, link, status, date, people and numbers columns) and 18 items, so
// the board screenshots show a real table. Everything is a pure function of the index.
// ---------------------------------------------------------------------------------------------

const AREAS = ['Infra / DevOps', 'Data model', 'Security', 'UX / Design', 'Frontend', 'Backend'];

function column(
  id: string,
  type: string,
  title: string,
  position: string,
  settings?: unknown,
): ColumnDef {
  return {
    id,
    type,
    title,
    position,
    settings: (settings ?? columnRegistry.defaultSettings(type)) as Record<string, unknown>,
  };
}

function roadmapStructure(): BoardStructure {
  const status = {
    labels: [
      { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
      { id: 'building', index: 0, label: 'Building', color: '#fdab3d' },
      { id: 'review', index: 3, label: 'In review', color: '#579bfc' },
      { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
      { id: 'notstarted', index: 4, label: 'Not started', color: '#757575' },
      { id: 'default_grey', index: 5, label: '', color: '#c4c4c4' },
    ],
  };
  const priority = {
    labels: [
      { id: 'critical', index: 0, label: 'Critical', color: '#df2f4a' },
      { id: 'high', index: 1, label: 'High', color: '#fdab3d' },
      { id: 'medium', index: 2, label: 'Medium', color: '#579bfc' },
      { id: 'default_grey', index: 5, label: '', color: '#c4c4c4' },
    ],
  };
  const groups: GroupDef[] = [
    { id: 'roadmap-p0', title: 'P0 · Foundations', color: '#757575', position: 'a0' },
    { id: 'roadmap-vf', title: 'VF · Visual fidelity', color: '#ff5ac4', position: 'a1' },
    { id: 'roadmap-p1', title: 'P1 · Core boards', color: '#579bfc', position: 'a2' },
  ];
  const columns = [
    column('area', 'dropdown', 'Area', 'a0', {
      limitSelect: false,
      labels: AREAS.map((label, id) => ({ id, label })),
    }),
    column('scope', 'long_text', 'Scope', 'a1'),
    column('spec', 'link', 'Spec / PR', 'a2'),
    column('status', 'status', 'Status', 'a3', status),
    column('priority', 'status', 'Priority', 'a4', priority),
    column('date', 'date', 'Date', 'a5'),
    column('person', 'people', 'Person', 'a6'),
    column('budget', 'numbers', 'Budget', 'a7', {
      unit: { symbol: '$', direction: 'left' },
      decimals: null,
    }),
  ];
  return {
    columns,
    subitemColumns: defaultSubitemColumns(columns.map((c) => c.id)),
    groups,
    itemTerminology: 'item',
  };
}

const ROADMAP_NAMES = [
  'Firebase project and emulators',
  'Architecture and data model spec',
  'Google sign-in and user profiles',
  'Repo scaffold and tooling',
  'Vibe design system and app shell',
  'CI/CD pipeline',
];

/** 18 items: six per group, with a value in most columns. */
function roadmapItems(): { id: string; item: ItemWrite }[] {
  const out: { id: string; item: ItemWrite }[] = [];
  const statusOrder = [1, 1, 0, 3, 4, 2];
  roadmapStructure().groups.forEach((group, g) => {
    ROADMAP_NAMES.forEach((name, i) => {
      const n = g * 6 + i;
      const values: Record<string, unknown> = {
        area: { ids: [n % AREAS.length, (n + 2) % AREAS.length] },
        scope: { text: `Scope notes for ${name.toLowerCase()}, kept to one line in the table.` },
        status: { index: statusOrder[(i + g) % statusOrder.length] },
        priority: { index: (n + g) % 3 },
        budget: String(((n * 7) % 12) * 250 + 400),
      };
      if (n % 2 === 0) values.spec = { url: 'https://example.com/spec', text: `PR #${100 + n}` };
      if (n % 4 !== 3) {
        const day = String(3 + ((n * 5) % 24)).padStart(2, '0');
        values.date = { date: `2026-${n % 3 === 0 ? '10' : '11'}-${day}` };
      }
      if (n % 3 !== 2) values.person = { personsAndTeams: [{ id: AVERY.uid, kind: 'person' }] };
      out.push({
        id: `roadmap-item-${String(n).padStart(2, '0')}`,
        item: {
          name: g === 0 ? name : `${name} ${g + 1}`,
          groupId: group.id,
          position: `a${i}`,
          parentItemId: null,
          values,
          state: 'active',
          deletedAt: null,
          createdAt: ago(10 * DAY),
          createdBy: AVERY.uid,
          updatedAt: ago(DAY + n * HOUR),
          updatedBy: AVERY.uid,
        },
      });
    });
  });
  return out;
}

/** The item the full item view screens open: a description, three subitems and an update. */
export const FULL_VIEW_ITEM = 'roadmap-item-17';

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const FULL_VIEW_DESCRIPTION = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Goal' }] },
    para('Ship the pipeline so every merge to main is built, tested and deployed automatically.'),
    {
      type: 'bulletList',
      content: [
        'Lint, typecheck and unit tests',
        'Rules tests on the emulator',
        'Preview deploys',
      ].map((t) => ({ type: 'listItem', content: [para(t)] })),
    },
    {
      type: 'taskList',
      content: [
        ['Review the workflow file', true],
        ['Enable branch protection', false],
        [
          'Document the release process in the spec, including how a failed deploy is rolled back by hand',
          false,
        ],
      ].map(([t, checked]) => ({
        type: 'taskItem',
        attrs: { checked },
        content: [para(t as string)],
      })),
    },
    para('Details live in the spec linked from this item.'),
  ],
};

async function seedRoadmapItems(firestore: Firestore): Promise<void> {
  const batch = firestore.batch();
  const items = firestore.collection('boards').doc(IDS.roadmap).collection('items');
  for (const { id, item } of roadmapItems()) {
    if (id !== FULL_VIEW_ITEM) {
      batch.set(items.doc(id), item);
      continue;
    }
    batch.set(items.doc(id), {
      ...item,
      description: { doc: FULL_VIEW_DESCRIPTION, text: 'Goal Ship the pipeline' },
      updatesCount: 1,
    });
    ['Write the workflow', 'Cache dependencies', 'Add the deploy job'].forEach((name, i) => {
      batch.set(items.doc(`${id}-sub-${i + 1}`), {
        ...item,
        name,
        position: `a${i}`,
        parentItemId: id,
        values: { sub_status: { index: i } },
      });
    });
    batch.set(items.doc(id).collection('updates').doc('full-view-update'), {
      itemId: id,
      authorId: AVERY.uid,
      authorName: AVERY.displayName,
      authorPhotoUrl: null,
      content: 'The workflow runs on every pull request now.',
      likes: [],
      repliesCount: 0,
      createdAt: ago(2 * HOUR),
      updatedAt: ago(2 * HOUR),
    });
  }
  await batch.commit();
}

/** A third workspace with no boards or folders. Removed again by the next `resetUserState`. */
export async function createEmptyWorkspace(): Promise<void> {
  await adminDb()
    .collection('workspaces')
    .doc(IDS.emptyWorkspace)
    .set({
      name: 'Studio',
      description: '',
      icon: 'S',
      color: '#a25ddc',
      ownerId: AVERY.uid,
      memberIds: [AVERY.uid],
      roles: { [AVERY.uid]: 'owner' },
      kind: 'open',
      createdAt: ago(5 * DAY),
      createdBy: AVERY.uid,
      updatedAt: ago(5 * DAY),
    });
}

/** Id of the shared view the "view tabs" screen adds to the roadmap board (and removes again). */
export const EXTRA_VIEW = 'view-due-soon';

/** A shared table view on the roadmap board, so the tab row shows two tabs. Pair with `removeView`. */
export async function addView(): Promise<void> {
  await adminDb()
    .collection('boards')
    .doc(IDS.roadmap)
    .collection('views')
    .doc(EXTRA_VIEW)
    .set({
      name: 'Due soon',
      type: 'table',
      position: 'a1',
      ownerId: null,
      settings: {
        filter: {
          personIds: [],
          filterGroup: { conjunction: 'and', conditions: [] },
          sortConditions: [],
          groupByColumnId: null,
        },
        hiddenColumnIds: [],
      },
      createdAt: ago(DAY),
      createdBy: AVERY.uid,
      updatedAt: ago(DAY),
      updatedBy: AVERY.uid,
    });
}

export async function removeView(): Promise<void> {
  await adminDb()
    .collection('boards')
    .doc(IDS.roadmap)
    .collection('views')
    .doc(EXTRA_VIEW)
    .delete();
}

/** Id of the shared Kanban view the Kanban screens add to the roadmap board (and remove again). */
export const KANBAN_VIEW = 'view-status-board';

/** A shared Kanban view on the roadmap board: lanes from Status, cards with three fields. */
export async function addKanbanView(): Promise<void> {
  await adminDb()
    .collection('boards')
    .doc(IDS.roadmap)
    .collection('views')
    .doc(KANBAN_VIEW)
    .set({
      name: 'Status board',
      type: 'kanban',
      position: 'a1',
      ownerId: null,
      settings: {
        filter: {
          personIds: [],
          filterGroup: { conjunction: 'and', conditions: [] },
          sortConditions: [],
          groupByColumnId: null,
        },
        hiddenColumnIds: [],
        kanban: {
          columnId: 'status',
          cardColumnIds: ['area', 'scope', 'spec'],
          collapsedLaneIds: [],
          showEmptyLanes: true,
        },
      },
      createdAt: ago(DAY),
      createdBy: AVERY.uid,
      updatedAt: ago(DAY),
      updatedBy: AVERY.uid,
    });
}

export async function removeKanbanView(): Promise<void> {
  await adminDb()
    .collection('boards')
    .doc(IDS.roadmap)
    .collection('views')
    .doc(KANBAN_VIEW)
    .delete();
}

/** Forget every recently visited board, so Home shows its "No boards visited yet" state. */
export async function clearRecents(): Promise<void> {
  const stale = await adminDb()
    .collection('users')
    .doc(AVERY.uid)
    .collection('recents')
    .listDocuments();
  await Promise.all(stale.map((ref) => ref.delete()));
}
