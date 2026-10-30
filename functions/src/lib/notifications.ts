import {
  NOTIFICATION_LIMITS,
  resolveBoardRole,
  type BoardAccessInput,
  type Notification,
  type NotificationKind,
  type NotificationPrefs,
  type WorkspaceRole,
} from '@atrium/shared';

/**
 * The bell inbox (P4). Cloud Functions write `users/{uid}/notifications/{id}` for three events:
 * someone is added to a People column, someone replies to your update, someone @mentions you.
 * Clients never create them (Firestore rules). The pure logic below takes an injected store so it
 * can be unit-tested; `admin-notifications.ts` adapts the Admin SDK to it.
 *
 * - One doc per recipient per event, with the deterministic id `${kind}-${eventId}-${uid}`, written
 *   with `create`: a retried trigger finds the doc already there and leaves it (and its `readAt`)
 *   alone.
 * - Recipients are filtered here, on the server: never the actor, only users who can read the board,
 *   only kinds the user has not switched off. A forged mention of a non-member notifies nobody.
 */

/** What a notification doc carries when it is created; the adapter adds `createdAt` and `readAt`. */
export type NewNotification = Omit<Notification, 'createdAt' | 'readAt'>;

/** The slice of a board document the notifications need. */
export interface NotificationBoard extends BoardAccessInput {
  name: string;
  workspaceId: string;
  columns: ReadonlyArray<{ id: string; type: string }>;
  subitemColumns: ReadonlyArray<{ id: string; type: string }>;
}

export interface ActorProfile {
  name: string;
  photoURL: string | null;
}

/** Narrow data-access interface. Every method is a read except `createNotification`. */
export interface NotificationStore {
  /** `null` when the board no longer exists. */
  getBoard(boardId: string): Promise<NotificationBoard | null>;
  /** The workspace's `roles` map (uid to role); empty when the workspace is gone. */
  getWorkspaceRoles(workspaceId: string): Promise<Record<string, WorkspaceRole>>;
  /** `users/{uid}.notificationPrefs`, `undefined` when unset (all kinds on). */
  getPrefs(uid: string): Promise<Partial<NotificationPrefs> | undefined>;
  /** The workspace member's display name and photo, `null` when there is no member document. */
  getMemberProfile(workspaceId: string, uid: string): Promise<ActorProfile | null>;
  /** The item's name, `null` when the item is gone. */
  getItemName(boardId: string, itemId: string): Promise<string | null>;
  /** The author of an update, `null` when the update is gone. */
  getUpdateAuthorId(boardId: string, itemId: string, updateId: string): Promise<string | null>;
  /** Creates the doc. Resolves `false` (no error) when it already exists, `true` when created. */
  createNotification(uid: string, id: string, data: NewNotification): Promise<boolean>;
}

export const notificationId = (kind: NotificationKind, eventId: string, uid: string): string =>
  `${kind}-${eventId}-${uid}`;

/** The first characters of an update or reply, whitespace trimmed. */
export const makeSnippet = (content: string): string =>
  content.trim().slice(0, NOTIFICATION_LIMITS.snippet);

/** A mention beats a reply beats an assignment when one person qualifies for several. */
const KIND_PRIORITY: Record<NotificationKind, number> = { mention: 3, reply: 2, assigned: 1 };

export interface NotificationCandidate {
  uid: string;
  kind: NotificationKind;
  /** Assigned only: the People column the person was added to. */
  columnId?: string;
}

export interface DeliveryEvent {
  /** The trigger's `event.id`; part of every notification id. */
  eventId: string;
  boardId: string;
  itemId: string;
  actorId: string;
  /** Used when the actor has no workspace member document (the update's own author fields). */
  actorFallback?: Partial<ActorProfile>;
  /** Skips the item read when the trigger already has the item. */
  itemName?: string;
  /** Skips the board read when the trigger already loaded it. */
  board?: NotificationBoard;
  updateId?: string | null;
  replyId?: string | null;
  snippet?: string;
  candidates: ReadonlyArray<NotificationCandidate>;
}

const clip = (value: string, max: number): string => value.slice(0, max);

/**
 * Filters the candidates and creates one notification per remaining recipient. Returns the number
 * of docs created (already-existing ones from a retry don't count). Reads the board, workspace,
 * item and actor once per event, and each recipient's prefs once.
 */
export async function deliverNotifications(
  store: NotificationStore,
  event: DeliveryEvent,
): Promise<number> {
  // One notification per person: the strongest kind wins; the actor never notifies themselves.
  const byUid = new Map<string, NotificationCandidate>();
  for (const candidate of event.candidates) {
    if (candidate.uid === event.actorId) continue;
    const current = byUid.get(candidate.uid);
    if (!current || KIND_PRIORITY[candidate.kind] > KIND_PRIORITY[current.kind]) {
      byUid.set(candidate.uid, candidate);
    }
  }
  if (byUid.size === 0) return 0;

  const board = event.board ?? (await store.getBoard(event.boardId));
  if (!board) return 0;
  const roles = await store.getWorkspaceRoles(board.workspaceId);

  const recipients: NotificationCandidate[] = [];
  for (const candidate of byUid.values()) {
    if (resolveBoardRole(board, candidate.uid, roles[candidate.uid]) === null) continue;
    const prefs = await store.getPrefs(candidate.uid);
    if (prefs?.[candidate.kind] === false) continue;
    recipients.push(candidate);
  }
  if (recipients.length === 0) return 0;

  const itemName = event.itemName ?? (await store.getItemName(event.boardId, event.itemId)) ?? '';
  const member = await store.getMemberProfile(board.workspaceId, event.actorId);
  const actorName = member?.name || event.actorFallback?.name || 'Someone';
  const actorPhotoURL = member ? member.photoURL : (event.actorFallback?.photoURL ?? null);

  let created = 0;
  for (const recipient of recipients) {
    const doc: NewNotification = {
      kind: recipient.kind,
      actorId: event.actorId,
      actorName: clip(actorName, 200),
      actorPhotoURL,
      workspaceId: board.workspaceId,
      boardId: event.boardId,
      boardName: clip(board.name, 200),
      itemId: event.itemId,
      itemName: clip(itemName, 500),
      updateId: event.updateId ?? null,
      replyId: event.replyId ?? null,
      columnId: recipient.columnId ?? null,
      snippet: event.snippet ?? '',
    };
    const id = notificationId(recipient.kind, event.eventId, recipient.uid);
    if (await store.createNotification(recipient.uid, id, doc)) created += 1;
  }
  return created;
}

// -- Assigned ---------------------------------------------------------------------------------

/** True when the two `values` maps differ (a cheap check so unrelated item edits cost no reads). */
export function valuesChanged(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): boolean {
  return JSON.stringify(before ?? {}) !== JSON.stringify(after ?? {});
}

function personIds(value: unknown): string[] {
  const list = (value as { personsAndTeams?: unknown } | null | undefined)?.personsAndTeams;
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const entry of list as Array<{ id?: unknown; kind?: unknown }>) {
    if (entry && entry.kind === 'person' && typeof entry.id === 'string') ids.push(entry.id);
  }
  return ids;
}

/**
 * People added to a People column by this write: ids in `after` that were not in `before`, for each
 * column of type `people` (a subitem uses the board's `subitemColumns`). On create `before` is
 * empty. A person added to several columns appears once, with the first column.
 */
export function addedPeople(
  board: Pick<NotificationBoard, 'columns' | 'subitemColumns'>,
  isSubitem: boolean,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): NotificationCandidate[] {
  const columns = isSubitem ? board.subitemColumns : board.columns;
  const added = new Map<string, NotificationCandidate>();
  for (const column of columns) {
    if (column.type !== 'people') continue;
    const previous = new Set(personIds(before?.[column.id]));
    for (const uid of personIds(after?.[column.id])) {
      if (!previous.has(uid) && !added.has(uid)) {
        added.set(uid, { uid, kind: 'assigned', columnId: column.id });
      }
    }
  }
  return [...added.values()];
}

export interface ItemWriteChange {
  eventId: string;
  boardId: string;
  itemId: string;
  /** `undefined` on create. */
  before?: { values?: Record<string, unknown> };
  after: {
    name?: string;
    state?: string;
    parentItemId?: string | null;
    values?: Record<string, unknown>;
    updatedBy?: string;
    createdBy?: string;
  };
}

/** `onItemPeopleAssigned`: notifies the people newly added to a People column. */
export async function notifyPeopleAssigned(
  store: NotificationStore,
  change: ItemWriteChange,
): Promise<number> {
  const { before, after } = change;
  if (after.state === 'deleted') return 0;
  if (!valuesChanged(before?.values, after.values)) return 0;
  const actorId =
    (before ? after.updatedBy : after.createdBy) ?? after.updatedBy ?? after.createdBy;
  if (!actorId) return 0;

  const board = await store.getBoard(change.boardId);
  if (!board) return 0;
  const candidates = addedPeople(board, after.parentItemId != null, before?.values, after.values);
  if (candidates.length === 0) return 0;

  return await deliverNotifications(store, {
    eventId: change.eventId,
    boardId: change.boardId,
    itemId: change.itemId,
    actorId,
    board,
    ...(typeof after.name === 'string' ? { itemName: after.name } : {}),
    candidates,
  });
}

// -- Description mentions ----------------------------------------------------------------------

/**
 * The uids of the `mention` nodes in a ProseMirror JSON doc: unique, string `attrs.id` only, at
 * most `NOTIFICATION_LIMITS.mentions`. The server trusts the saved doc, never a client-sent list.
 */
export function mentionedUidsOf(doc: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || found.size >= NOTIFICATION_LIMITS.mentions) return;
    const n = node as { type?: unknown; attrs?: { id?: unknown }; content?: unknown };
    if (n.type === 'mention' && typeof n.attrs?.id === 'string' && n.attrs.id) {
      found.add(n.attrs.id);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return [...found];
}

interface DescriptionLike {
  doc?: unknown;
  text?: unknown;
}

const descriptionOf = (value: unknown): DescriptionLike | undefined =>
  value && typeof value === 'object' ? (value as DescriptionLike) : undefined;

export interface DescriptionWriteChange {
  eventId: string;
  boardId: string;
  itemId: string;
  before?: { description?: unknown };
  after: { name?: string; state?: string; description?: unknown; updatedBy?: string };
}

/**
 * `onItemPeopleAssigned`: members whose mention chip is new in the saved description get a
 * `mention` (no update or reply attached). Reads nothing unless the description changed, and the
 * board only when there is a new uid.
 */
export async function notifyDescriptionMentions(
  store: NotificationStore,
  change: DescriptionWriteChange,
): Promise<number> {
  const { before, after } = change;
  if (after.state === 'deleted') return 0;
  if (JSON.stringify(before?.description ?? null) === JSON.stringify(after.description ?? null)) {
    return 0;
  }
  const previous = new Set(mentionedUidsOf(descriptionOf(before?.description)?.doc));
  const added = mentionedUidsOf(descriptionOf(after.description)?.doc).filter(
    (uid) => !previous.has(uid),
  );
  if (added.length === 0) return 0;
  const actorId = after.updatedBy;
  if (!actorId) return 0;
  const text = descriptionOf(after.description)?.text;
  return await deliverNotifications(store, {
    eventId: change.eventId,
    boardId: change.boardId,
    itemId: change.itemId,
    actorId,
    ...(typeof after.name === 'string' ? { itemName: after.name } : {}),
    updateId: null,
    replyId: null,
    snippet: makeSnippet(typeof text === 'string' ? text : ''),
    candidates: added.map((uid) => ({ uid, kind: 'mention' as const })),
  });
}

// -- Updates and replies -------------------------------------------------------------------------

export interface PostedContent {
  authorId?: string;
  authorName?: string;
  authorPhotoUrl?: string | null;
  content?: string;
  mentions?: unknown;
}

const mentionIds = (mentions: unknown): string[] =>
  Array.isArray(mentions) ? mentions.filter((m): m is string => typeof m === 'string') : [];

const actorFallbackOf = (post: PostedContent): Partial<ActorProfile> => ({
  ...(post.authorName ? { name: post.authorName } : {}),
  ...(post.authorPhotoUrl !== undefined ? { photoURL: post.authorPhotoUrl } : {}),
});

/** `onUpdateCreated`: each mentioned id gets a `mention`. */
export async function notifyUpdateMentions(
  store: NotificationStore,
  event: {
    eventId: string;
    boardId: string;
    itemId: string;
    updateId: string;
    update: PostedContent;
  },
): Promise<number> {
  const { update } = event;
  const mentions = mentionIds(update.mentions);
  if (!update.authorId || mentions.length === 0) return 0;
  return await deliverNotifications(store, {
    eventId: event.eventId,
    boardId: event.boardId,
    itemId: event.itemId,
    actorId: update.authorId,
    actorFallback: actorFallbackOf(update),
    updateId: event.updateId,
    snippet: makeSnippet(update.content ?? ''),
    candidates: mentions.map((uid) => ({ uid, kind: 'mention' as const })),
  });
}

/**
 * `onReplyCreated`: the parent update's author gets a `reply`, each mentioned id a `mention`. Someone
 * who qualifies for both gets the single `mention`.
 */
export async function notifyReply(
  store: NotificationStore,
  event: {
    eventId: string;
    boardId: string;
    itemId: string;
    updateId: string;
    replyId: string;
    reply: PostedContent;
  },
): Promise<number> {
  const { reply } = event;
  if (!reply.authorId) return 0;
  const parentAuthorId = await store.getUpdateAuthorId(event.boardId, event.itemId, event.updateId);
  const candidates: NotificationCandidate[] = mentionIds(reply.mentions).map((uid) => ({
    uid,
    kind: 'mention' as const,
  }));
  if (parentAuthorId) candidates.push({ uid: parentAuthorId, kind: 'reply' });
  return await deliverNotifications(store, {
    eventId: event.eventId,
    boardId: event.boardId,
    itemId: event.itemId,
    actorId: reply.authorId,
    actorFallback: actorFallbackOf(reply),
    updateId: event.updateId,
    replyId: event.replyId,
    snippet: makeSnippet(reply.content ?? ''),
    candidates,
  });
}

// -- Retention -----------------------------------------------------------------------------------

/** Most docs deleted per batch; Firestore allows 500 writes per batch. */
export const PURGE_BATCH_SIZE = 400;
/** Safety cap on batches per run (the sweep runs daily, so any rest waits for tomorrow). */
const PURGE_MAX_BATCHES = 100;

export interface NotificationPurgeStore {
  /** Up to `limit` notification doc paths whose `createdAt` is before `cutoff`. */
  listExpired(cutoff: Date, limit: number): Promise<string[]>;
  deletePaths(paths: string[]): Promise<void>;
}

export const retentionCutoff = (nowMs: number): Date =>
  new Date(nowMs - NOTIFICATION_LIMITS.retentionDays * 24 * 60 * 60 * 1000);

/** `purgeOldNotifications`: deletes notifications older than the retention window. */
export async function purgeExpiredNotifications(
  store: NotificationPurgeStore,
  nowMs: number,
): Promise<number> {
  const cutoff = retentionCutoff(nowMs);
  let deleted = 0;
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
    const paths = await store.listExpired(cutoff, PURGE_BATCH_SIZE);
    if (paths.length === 0) break;
    await store.deletePaths(paths);
    deleted += paths.length;
    if (paths.length < PURGE_BATCH_SIZE) break;
  }
  return deleted;
}
