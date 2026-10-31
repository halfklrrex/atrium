import {
  ACTIVITY_LIMITS,
  columnRegistry,
  type ActivityData,
  type ActivityEvent,
  type ActivityKind,
} from '@atrium/shared';

/**
 * The activity log (P4, spec docs/specs/P4-activity-audit-log.md). Every meaningful change on a
 * board leaves an entry in `boards/{id}/activity`, written only by Cloud Functions:
 * - changes made by a callable are logged inside that callable's transaction (`activityDoc` plus the
 *   adapter's `appendActivityTx`);
 * - changes made by a client write are logged by the `onItemWrittenActivity` /
 *   `onBoardWrittenActivity` triggers, which diff the document before and after.
 * The logic here is pure; `admin-activity.ts` adapts the Admin SDK to `ActivityStore`.
 *
 * Idempotency: the entries of one trigger event get the deterministic ids `${event.id}-${n}` and are
 * written with `create()` in one batch, so a retried event either finds them all or writes them all.
 * Bounded amplification: one write produces at most `ACTIVITY_LIMITS.perEvent` entries.
 */

/** What an entry carries before the adapter adds `createdAt` and `expiresAt`. */
export type NewActivity = Omit<ActivityEvent, 'createdAt' | 'expiresAt'>;

export interface MemberProfile {
  name: string;
  photoURL: string | null;
}

/** The kind-specific part of an entry; everything not given is stored as `null` / empty. */
export interface ActivityFields {
  itemId?: string | null;
  itemName?: string | null;
  parentItemId?: string | null;
  columnId?: string | null;
  columnTitle?: string | null;
  columnType?: string | null;
  groupId?: string | null;
  groupTitle?: string | null;
  data?: ActivityData;
}

/** One planned entry: the kind plus its fields, before an actor is attached. */
export interface ActivityPlan {
  kind: ActivityKind;
  fields: ActivityFields;
}

export interface ActivityActor {
  id: string;
  name: string;
  photoUrl: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ACTOR_NAME = 'Someone';

/** Epoch milliseconds when an entry written at `nowMs` is deleted by the TTL policy. */
export function expiresAtMs(nowMs: number): number {
  return nowMs + ACTIVITY_LIMITS.retentionDays * DAY_MS;
}

/** `expiresAtMs` as a Date (the adapter turns it into a Firestore Timestamp). */
export const expiresAt = (nowMs: number): Date => new Date(expiresAtMs(nowMs));

export const clipText = (value: string, max: number = ACTIVITY_LIMITS.text): string =>
  value.length > max ? value.slice(0, max) : value;

/** The raw value when its JSON fits `ACTIVITY_LIMITS.rawBytes`, otherwise `undefined` (omitted). */
export function rawValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (json === undefined) return undefined;
  return Buffer.byteLength(json, 'utf8') <= ACTIVITY_LIMITS.rawBytes ? value : undefined;
}

export function actorOf(uid: string, profile?: MemberProfile | null): ActivityActor {
  return {
    id: uid,
    name: clipText(profile?.name?.trim() || DEFAULT_ACTOR_NAME),
    photoUrl: profile?.photoURL ?? null,
  };
}

/** Drops `undefined` keys (Firestore refuses them) and caps the display text fields. */
function cleanData(data: ActivityData | undefined): ActivityData {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === undefined) continue;
    out[key] =
      typeof value === 'string' && /Text$|Name$|Title$/.test(key) ? clipText(value) : value;
  }
  return out as ActivityData;
}

/** Builds the entry for `kind` as `actor` did it. */
export function activityDoc(
  actor: ActivityActor,
  kind: ActivityKind,
  fields: ActivityFields = {},
): NewActivity {
  const title = (v: string | null | undefined) => (v == null ? null : clipText(v));
  return {
    kind,
    actorId: actor.id,
    actorName: clipText(actor.name),
    actorPhotoUrl: actor.photoUrl,
    itemId: fields.itemId ?? null,
    itemName: fields.itemName == null ? null : clipText(fields.itemName, 500),
    parentItemId: fields.parentItemId ?? null,
    columnId: fields.columnId ?? null,
    columnTitle: title(fields.columnTitle),
    columnType: fields.columnType ?? null,
    groupId: fields.groupId ?? null,
    groupTitle: title(fields.groupTitle),
    data: cleanData(fields.data),
  };
}

// -- Text helpers ------------------------------------------------------------------------------

const PEOPLE_SHOWN = 3;

function personUids(value: unknown): string[] {
  const list = (value as { personsAndTeams?: unknown } | null | undefined)?.personsAndTeams;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const entry of list as Array<{ id?: unknown }>) {
    if (entry && typeof entry.id === 'string') ids.push(entry.id);
  }
  return ids;
}

/**
 * Display text of a cell: the registry's `toText`, except People, whose text lists ids (the log
 * shows member names, `+n` past three). Never throws; capped to `ACTIVITY_LIMITS.text`.
 */
export function valueText(
  type: string,
  value: unknown,
  settings: unknown,
  profiles: ReadonlyMap<string, MemberProfile>,
): string {
  if (value === null || value === undefined) return '';
  try {
    if (type === 'people') {
      const ids = personUids(value);
      const names = ids.map((id) => profiles.get(id)?.name || DEFAULT_ACTOR_NAME);
      const shown = names.slice(0, PEOPLE_SHOWN).join(', ');
      return clipText(
        names.length > PEOPLE_SHOWN ? `${shown} +${names.length - PEOPLE_SHOWN}` : shown,
      );
    }
    if (!columnRegistry.has(type)) return '';
    return clipText(columnRegistry.toText(type, value, settings));
  } catch {
    return '';
  }
}

// -- Deep equality -----------------------------------------------------------------------------

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const key of keys) if (!sameJson(ao[key], bo[key])) return false;
  return true;
}

// -- Item diff ---------------------------------------------------------------------------------

export interface ActivityColumn {
  id: string;
  title: string;
  type: string;
  settings?: unknown;
}
export interface ActivityGroup {
  id: string;
  title: string;
}

/** The slice of a board the activity logic needs. */
export interface ActivityBoard {
  workspaceId: string;
  columns: ReadonlyArray<ActivityColumn>;
  subitemColumns: ReadonlyArray<ActivityColumn>;
  groups: ReadonlyArray<ActivityGroup>;
}

/** The item fields the diff reads. */
export interface ActivityItemDoc {
  name?: unknown;
  groupId?: unknown;
  state?: unknown;
  parentItemId?: unknown;
  values?: Record<string, unknown>;
  createdBy?: unknown;
  updatedBy?: unknown;
  updatedAt?: unknown;
}

export interface ItemWriteChange {
  /** Missing on create. */
  before?: ActivityItemDoc;
  after: ActivityItemDoc;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Who made this write: `updatedBy` (rules force it to the caller), `createdBy` on create. */
export function itemActorId(change: ItemWriteChange): string | undefined {
  return change.before
    ? (str(change.after.updatedBy) ?? str(change.after.createdBy))
    : (str(change.after.createdBy) ?? str(change.after.updatedBy));
}

function sameTimestamp(a: unknown, b: unknown): boolean {
  const am = (a as { toMillis?: () => number } | undefined)?.toMillis;
  const bm = (b as { toMillis?: () => number } | undefined)?.toMillis;
  if (typeof am === 'function' && typeof bm === 'function') {
    return (a as { toMillis(): number }).toMillis() === (b as { toMillis(): number }).toMillis();
  }
  return a === b;
}

interface ValueChange {
  column: ActivityColumn;
  from: unknown;
  to: unknown;
}

function changedValues(change: ItemWriteChange, board: ActivityBoard): ValueChange[] {
  const columns = change.after.parentItemId ? board.subitemColumns : board.columns;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const before = change.before?.values ?? {};
  const after = change.after.values ?? {};
  const out: ValueChange[] = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const column = byId.get(id);
    // Derived columns store nothing; unknown columns (deleted, or a type this build lacks) have no
    // meaning to show.
    if (!column || !columnRegistry.has(column.type) || columnRegistry.isDerived(column.type)) {
      continue;
    }
    const from = before[id] ?? null;
    const to = after[id] ?? null;
    if (!sameJson(from, to)) out.push({ column, from, to });
  }
  return out;
}

/** Uids whose names the texts of this write need: People values that changed. */
export function itemProfileUids(change: ItemWriteChange, board: ActivityBoard): string[] {
  const uids = new Set<string>();
  for (const v of changedValues(change, board)) {
    if (v.column.type !== 'people') continue;
    for (const id of [...personUids(v.from), ...personUids(v.to)]) uids.add(id);
  }
  return [...uids];
}

const stateKind = (from: string | undefined, to: string | undefined): ActivityKind | null => {
  if (!from || !to || from === to) return null;
  if (to === 'active') return 'item_restored';
  return to === 'archived' ? 'item_archived' : to === 'deleted' ? 'item_deleted' : null;
};

/**
 * The entries one item write produces. Only a user edit counts: on update the write must have moved
 * `updatedAt` (client writes always do; the type-change migration and `onItemCreated` write
 * `values.*` or `seq` without it, so they log nothing here). Ignored on purpose: description,
 * position, `seq`, `boardSeq`, `descriptionImages`, `updatesCount`, index fields and derived columns.
 */
export function diffItemActivity(
  change: ItemWriteChange,
  board: ActivityBoard,
  profiles: ReadonlyMap<string, MemberProfile>,
): ActivityPlan[] {
  const { before, after } = change;
  const base = (): ActivityFields => ({
    itemName: str(after.name) ?? '',
    parentItemId: str(after.parentItemId) ?? null,
  });
  const groupTitle = (id: string | undefined) =>
    board.groups.find((g) => g.id === id)?.title ?? null;

  if (!before) {
    const groupId = str(after.groupId);
    return [
      {
        kind: 'item_created',
        fields: { ...base(), groupId: groupId ?? null, groupTitle: groupTitle(groupId) },
      },
    ];
  }
  if (sameTimestamp(before.updatedAt, after.updatedAt)) return [];

  const plan: ActivityPlan[] = [];
  if (str(before.name) !== str(after.name)) {
    plan.push({
      kind: 'item_renamed',
      fields: {
        ...base(),
        data: { fromText: str(before.name) ?? '', toText: str(after.name) ?? '' },
      },
    });
  }
  const fromGroup = str(before.groupId);
  const toGroup = str(after.groupId);
  if (fromGroup !== toGroup) {
    const fromTitle = groupTitle(fromGroup);
    plan.push({
      kind: 'item_moved',
      fields: {
        ...base(),
        groupId: toGroup ?? null,
        groupTitle: groupTitle(toGroup),
        data: {
          ...(fromGroup ? { fromGroupId: fromGroup } : {}),
          ...(fromTitle ? { fromGroupTitle: fromTitle } : {}),
        },
      },
    });
  }
  const kind = stateKind(str(before.state), str(after.state));
  if (kind) plan.push({ kind, fields: base() });

  for (const v of changedValues(change, board)) {
    const fromRaw = rawValue(v.from);
    const toRaw = rawValue(v.to);
    plan.push({
      kind: 'value_changed',
      fields: {
        ...base(),
        columnId: v.column.id,
        columnTitle: v.column.title,
        columnType: v.column.type,
        data: {
          fromText: valueText(v.column.type, v.from, v.column.settings, profiles),
          toText: valueText(v.column.type, v.to, v.column.settings, profiles),
          ...(fromRaw !== undefined ? { fromValue: fromRaw } : {}),
          ...(toRaw !== undefined ? { toValue: toRaw } : {}),
        },
      },
    });
  }

  if (plan.length <= ACTIVITY_LIMITS.perEvent) return plan;
  const kept = plan.slice(0, ACTIVITY_LIMITS.perEvent - 1);
  const more = plan.length - kept.length;
  return [...kept, { kind: 'value_changed', fields: { ...base(), data: { more } } }];
}

// -- Board diff --------------------------------------------------------------------------------

/** The board fields the diff reads. */
export interface ActivityBoardDoc {
  name?: unknown;
  columns?: ReadonlyArray<ActivityColumn>;
  groups?: ReadonlyArray<ActivityGroup>;
  createdBy?: unknown;
  updatedBy?: unknown;
}

export const boardActorId = (after: ActivityBoardDoc): string | undefined =>
  str(after.updatedBy) ?? str(after.createdBy);

/**
 * Board-level entries from a board write: name, and the column and group id sets and titles. Column
 * `type` / `settings`, the `migrating` and `lastTypeChange` marks, `kind`, `access`, `accessUids`,
 * `derivedColumnIds` and `serverManagedColumnIds` are not looked at, so what a callable already
 * logged is never logged twice and `onBoardColumnsWritten`'s own write logs nothing.
 */
export function diffBoardActivity(
  before: ActivityBoardDoc,
  after: ActivityBoardDoc,
): ActivityPlan[] {
  const plan: ActivityPlan[] = [];
  const fromName = str(before.name);
  const toName = str(after.name);
  if (fromName !== toName) {
    plan.push({
      kind: 'board_renamed',
      fields: { data: { fromText: fromName ?? '', toText: toName ?? '' } },
    });
  }

  const columnsBefore = new Map((before.columns ?? []).map((c) => [c.id, c]));
  const columnsAfter = new Map((after.columns ?? []).map((c) => [c.id, c]));
  for (const [id, c] of columnsAfter) {
    const old = columnsBefore.get(id);
    const fields = { columnId: id, columnTitle: c.title, columnType: c.type };
    if (!old) plan.push({ kind: 'column_added', fields });
    else if (old.title !== c.title) {
      plan.push({
        kind: 'column_renamed',
        fields: { ...fields, data: { fromText: old.title, toText: c.title } },
      });
    }
  }
  for (const [id, c] of columnsBefore) {
    if (!columnsAfter.has(id)) {
      plan.push({
        kind: 'column_deleted',
        fields: { columnId: id, columnTitle: c.title, columnType: c.type },
      });
    }
  }

  const groupsBefore = new Map((before.groups ?? []).map((g) => [g.id, g]));
  const groupsAfter = new Map((after.groups ?? []).map((g) => [g.id, g]));
  for (const [id, g] of groupsAfter) {
    const old = groupsBefore.get(id);
    if (!old) plan.push({ kind: 'group_added', fields: { groupId: id, groupTitle: g.title } });
    else if (old.title !== g.title) {
      plan.push({
        kind: 'group_renamed',
        fields: {
          groupId: id,
          groupTitle: g.title,
          data: { fromText: old.title, toText: g.title },
        },
      });
    }
  }
  for (const [id, g] of groupsBefore) {
    if (!groupsAfter.has(id)) {
      plan.push({ kind: 'group_deleted', fields: { groupId: id, groupTitle: g.title } });
    }
  }
  return plan.slice(0, ACTIVITY_LIMITS.perEvent);
}

// -- Store and the orchestration the triggers call ---------------------------------------------

export interface NewActivityEntry {
  id: string;
  doc: NewActivity;
}

/** Narrow data-access interface; `admin-activity.ts` adapts the Admin SDK to it. */
export interface ActivityStore {
  /** `null` when the board no longer exists. */
  getBoard(boardId: string): Promise<ActivityBoard | null>;
  /** Display names and photos of the workspace members that have a member document. */
  getMemberProfiles(
    workspaceId: string,
    uids: readonly string[],
  ): Promise<Map<string, MemberProfile>>;
  /** The item's name, `null` when the item is gone. */
  getItemName(boardId: string, itemId: string): Promise<string | null>;
  /**
   * Creates the entries in one batch. Resolves `0` (no error) when they already exist, which is
   * what a retried event finds.
   */
  createMany(boardId: string, entries: readonly NewActivityEntry[]): Promise<number>;
}

export const activityEntryId = (eventId: string, n: number): string => `${eventId}-${n}`;

function toEntries(
  eventId: string,
  actor: ActivityActor,
  plan: readonly ActivityPlan[],
): NewActivityEntry[] {
  return plan.map((p, n) => ({
    id: activityEntryId(eventId, n),
    doc: activityDoc(actor, p.kind, p.fields),
  }));
}

/** Logs what an item write changed. Returns the number of entries created. */
export async function recordItemActivity(
  store: ActivityStore,
  event: { eventId: string; boardId: string; itemId: string } & ItemWriteChange,
): Promise<number> {
  const actorId = itemActorId(event);
  if (!actorId) return 0;
  const board = await store.getBoard(event.boardId);
  if (!board) return 0;
  const change: ItemWriteChange = event.before
    ? { before: event.before, after: event.after }
    : { after: event.after };
  const empty = new Map<string, MemberProfile>();
  if (diffItemActivity(change, board, empty).length === 0) return 0;

  const profiles = await store.getMemberProfiles(board.workspaceId, [
    actorId,
    ...itemProfileUids(change, board),
  ]);
  const plan = diffItemActivity(change, board, profiles).map((p) => ({
    kind: p.kind,
    fields: { ...p.fields, itemId: event.itemId },
  }));
  const actor = actorOf(actorId, profiles.get(actorId));
  return store.createMany(event.boardId, toEntries(event.eventId, actor, plan));
}

/** Logs what a board write changed. Returns the number of entries created. */
export async function recordBoardActivity(
  store: ActivityStore,
  event: { eventId: string; boardId: string; before?: ActivityBoardDoc; after?: ActivityBoardDoc },
): Promise<number> {
  // Create and delete of the board itself are not logged.
  if (!event.before || !event.after) return 0;
  const plan = diffBoardActivity(event.before, event.after);
  if (plan.length === 0) return 0;
  const actorId = boardActorId(event.after);
  if (!actorId) return 0;
  const board = await store.getBoard(event.boardId);
  if (!board) return 0;
  const profiles = await store.getMemberProfiles(board.workspaceId, [actorId]);
  const actor = actorOf(actorId, profiles.get(actorId));
  return store.createMany(event.boardId, toEntries(event.eventId, actor, plan));
}

/** A top-level update was posted on an item. */
export async function recordUpdatePosted(
  store: ActivityStore,
  event: {
    eventId: string;
    boardId: string;
    itemId: string;
    update: {
      authorId?: unknown;
      authorName?: unknown;
      authorPhotoUrl?: unknown;
      content?: unknown;
    };
  },
): Promise<number> {
  const authorId = str(event.update.authorId);
  if (!authorId) return 0;
  const board = await store.getBoard(event.boardId);
  if (!board) return 0;
  const profiles = await store.getMemberProfiles(board.workspaceId, [authorId]);
  const member = profiles.get(authorId);
  const photo = str(event.update.authorPhotoUrl) ?? null;
  const actor = actorOf(
    authorId,
    member ?? { name: str(event.update.authorName) ?? '', photoURL: photo },
  );
  const itemName = (await store.getItemName(event.boardId, event.itemId)) ?? '';
  const snippet = clipText(
    (typeof event.update.content === 'string' ? event.update.content : '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    ACTIVITY_LIMITS.snippet,
  );
  return store.createMany(
    event.boardId,
    toEntries(event.eventId, actor, [
      { kind: 'update_posted', fields: { itemId: event.itemId, itemName, data: { snippet } } },
    ]),
  );
}
