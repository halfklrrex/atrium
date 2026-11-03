import {
  type BoardKind,
  type BoardRole,
  type ClickButtonRequest,
  type ButtonAction,
  type ClickButtonResult,
  type StartTimeTrackingRequest,
  type StartTimeTrackingResult,
  type StopTimeTrackingRequest,
  type StopTimeTrackingResult,
  type TimeTrackingValue,
  type WorkspaceRole,
  BUTTON_RENAME_MAX_LENGTH,
  COLUMN_LOCKED_MESSAGE,
  buttonSettingsSchema,
  canEditBoard,
  canEditColumn,
  renderRenameTemplate,
  resolveBoardRole,
  startTimer,
  stopTimer,
  timeTrackingValueSchema,
  validateButtonActions,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { actorOf, activityDoc, type MemberProfile, type NewActivity } from './activity';

export interface BoardData {
  kind: BoardKind;
  workspaceId: string;
  access: Record<string, BoardRole>;
  columns: Array<{
    id: string;
    type: string;
    title?: string;
    settings?: unknown;
    migrating?: unknown;
  }>;
  groups?: Array<{ id: string }>;
  columnLocks?: string[];
}

export interface ItemData {
  id: string;
  name: string;
  state: 'active' | 'archived' | 'deleted';
  values: Record<string, unknown>;
}

export interface ColumnActionsTx {
  getBoard(boardId: string): Promise<BoardData | null>;
  getWorkspaceMemberRole(workspaceId: string, uid: string): Promise<WorkspaceRole | null>;
  getItem(boardId: string, itemId: string): Promise<ItemData | null>;
  updateItemValues(
    boardId: string,
    itemId: string,
    columnId: string,
    value: unknown,
    updatedBy: string,
    serverTimestamp: unknown,
  ): void;
  /**
   * Field-path patch of one item (`values.<colId>`, `name`, `groupId`, `state`): never the whole
   * `values` map. The adapter adds `updatedAt` / `updatedBy`. A `null` under a `values.` key
   * deletes the cell.
   */
  updateItem(
    boardId: string,
    itemId: string,
    patch: Record<string, unknown>,
    updatedBy: string,
    serverTimestamp: unknown,
  ): void;
  /**
   * True when `uid` already clicked this button on this item at or after `sinceMs` (reads the
   * activity log). Must run before the first write of the transaction.
   */
  hasRecentButtonClick(
    boardId: string,
    itemId: string,
    columnId: string,
    uid: string,
    sinceMs: number,
  ): Promise<boolean>;
  /** The workspace member's display name and photo, `null` when there is no member document. */
  getMemberProfile(workspaceId: string, uid: string): Promise<MemberProfile | null>;
  /** Creates the activity entry (P4) in the same transaction and returns its id. */
  appendActivity(boardId: string, activity: NewActivity): Promise<string>;
  nowMs(): number;
  newSessionId(): string;
}

async function requireColumnEditAccess(
  tx: ColumnActionsTx,
  boardId: string,
  uid: string,
  columnId: string,
): Promise<BoardData> {
  const board = await tx.getBoard(boardId);
  if (!board) {
    throw new HttpsError('not-found', `Board "${boardId}" not found.`);
  }

  const wsRole = await tx.getWorkspaceMemberRole(board.workspaceId, uid);
  const role = resolveBoardRole(board, uid, wsRole);
  if (!canEditBoard(role)) {
    throw new HttpsError('permission-denied', 'You do not have permission to edit this board.');
  }
  if (!canEditColumn(role, board, columnId)) {
    throw new HttpsError('permission-denied', COLUMN_LOCKED_MESSAGE);
  }
  return board;
}

export async function startTimeTrackingInTransaction(
  tx: ColumnActionsTx,
  uid: string,
  req: StartTimeTrackingRequest,
  serverTimestamp: unknown,
): Promise<StartTimeTrackingResult> {
  const board = await requireColumnEditAccess(tx, req.boardId, uid, req.columnId);

  const col = board.columns.find((c) => c.id === req.columnId);
  if (!col) {
    throw new HttpsError('not-found', `Column "${req.columnId}" not found on board.`);
  }
  if (col.type !== 'time_tracking') {
    throw new HttpsError(
      'invalid-argument',
      `Column "${req.columnId}" is not a time_tracking column.`,
    );
  }

  const item = await tx.getItem(req.boardId, req.itemId);
  if (!item) {
    throw new HttpsError('not-found', `Item "${req.itemId}" not found.`);
  }
  if (item.state !== 'active') {
    throw new HttpsError('failed-precondition', 'Cannot start timer on non-active item.');
  }

  const rawVal = item.values[req.columnId];
  let val: TimeTrackingValue;
  if (rawVal === undefined || rawVal === null) {
    val = { duration: 0, running: false, history: [] };
  } else {
    const parsed = timeTrackingValueSchema.safeParse(rawVal);
    if (!parsed.success) {
      throw new HttpsError('failed-precondition', 'Stored time tracking cell value is invalid.');
    }
    val = parsed.data;
  }

  // Idempotency: repeated start while timer is already running returns the existing open session
  if (val.running) {
    const openSession = val.history?.find((s) => s.endedAt === undefined);
    if (openSession) {
      return { success: true, sessionId: openSession.id, startedAt: openSession.startedAt };
    }
    throw new HttpsError('failed-precondition', 'Timer is already running for this item.');
  }

  if ((val.history?.length ?? 0) >= 500) {
    throw new HttpsError('resource-exhausted', 'Maximum session history limit (500) reached.');
  }

  const nowMs = tx.nowMs();
  const sessionId = tx.newSessionId();
  let updated = startTimer(val, uid, sessionId, nowMs);

  if (req.note && updated.history) {
    const idx = updated.history.findIndex((s) => s.id === sessionId);
    if (idx !== -1 && updated.history[idx]) {
      const hist = [...updated.history];
      hist[idx] = { ...hist[idx]!, note: req.note };
      updated = { ...updated, history: hist };
    }
  }

  const parsedUpdated = timeTrackingValueSchema.parse(updated);
  tx.updateItemValues(req.boardId, req.itemId, req.columnId, parsedUpdated, uid, serverTimestamp);
  return { success: true, sessionId, startedAt: nowMs };
}

export async function stopTimeTrackingInTransaction(
  tx: ColumnActionsTx,
  uid: string,
  req: StopTimeTrackingRequest,
  serverTimestamp: unknown,
): Promise<StopTimeTrackingResult> {
  const board = await requireColumnEditAccess(tx, req.boardId, uid, req.columnId);

  const col = board.columns.find((c) => c.id === req.columnId);
  if (!col) {
    throw new HttpsError('not-found', `Column "${req.columnId}" not found on board.`);
  }
  if (col.type !== 'time_tracking') {
    throw new HttpsError(
      'invalid-argument',
      `Column "${req.columnId}" is not a time_tracking column.`,
    );
  }

  const item = await tx.getItem(req.boardId, req.itemId);
  if (!item) {
    throw new HttpsError('not-found', `Item "${req.itemId}" not found.`);
  }

  const rawVal = item.values[req.columnId];
  if (rawVal === undefined || rawVal === null) {
    throw new HttpsError('failed-precondition', 'Timer is not currently running.');
  }
  const parsed = timeTrackingValueSchema.safeParse(rawVal);
  if (!parsed.success) {
    throw new HttpsError('failed-precondition', 'Stored time tracking cell value is invalid.');
  }

  const val = parsed.data;

  // Idempotency: if caller provided sessionId and timer is already stopped, return no-op success
  if (!val.running) {
    if (req.sessionId) {
      const closed = val.history?.find((s) => s.id === req.sessionId && s.endedAt !== undefined);
      if (closed) {
        return { success: true, duration: val.duration, stoppedAt: closed.endedAt ?? tx.nowMs() };
      }
    }
    throw new HttpsError('failed-precondition', 'Timer is not currently running.');
  }

  // If caller provided sessionId for a running timer, verify it matches open session or already closed
  if (req.sessionId) {
    const openSession = val.history?.find((s) => s.endedAt === undefined);
    if (openSession && openSession.id !== req.sessionId) {
      const alreadyClosed = val.history?.find(
        (s) => s.id === req.sessionId && s.endedAt !== undefined,
      );
      if (alreadyClosed) {
        return {
          success: true,
          duration: val.duration,
          stoppedAt: alreadyClosed.endedAt ?? tx.nowMs(),
        };
      }
    }
  }

  const nowMs = tx.nowMs();
  const updated = stopTimer(val, nowMs);
  const parsedUpdated = timeTrackingValueSchema.parse(updated);

  tx.updateItemValues(req.boardId, req.itemId, req.columnId, parsedUpdated, uid, serverTimestamp);
  return { success: true, duration: parsedUpdated.duration, stoppedAt: nowMs };
}

/** A second click of the same button on the same item by the same user inside this window is refused. */
export const BUTTON_REPEAT_GUARD_MS = 2000;

/** One person a click notifies, with the message of the last `notify` action that listed them. */
export interface ButtonNotifyTarget {
  uid: string;
  message: string;
}

/** What the callable delivers after the transaction commits (never inside it). */
export interface ButtonNotifyPlan {
  columnId: string;
  buttonLabel: string;
  /** The item's name after the actions ran. */
  itemName: string;
  targets: ButtonNotifyTarget[];
}

export async function clickButtonInTransaction(
  tx: ColumnActionsTx,
  uid: string,
  req: ClickButtonRequest,
  serverTimestamp: unknown,
): Promise<ClickButtonResult & { notify?: ButtonNotifyPlan }> {
  const board = await requireColumnEditAccess(tx, req.boardId, uid, req.columnId);

  const col = board.columns.find((c) => c.id === req.columnId);
  if (!col) {
    throw new HttpsError('not-found', `Column "${req.columnId}" not found on board.`);
  }
  if (col.type !== 'button') {
    throw new HttpsError('invalid-argument', `Column "${req.columnId}" is not a button column.`);
  }

  const item = await tx.getItem(req.boardId, req.itemId);
  if (!item) {
    throw new HttpsError('not-found', `Item "${req.itemId}" not found.`);
  }
  if (item.state !== 'active') {
    throw new HttpsError('failed-precondition', 'Cannot click button on non-active item.');
  }

  const nowMs = tx.nowMs();
  const settingsParsed = buttonSettingsSchema.safeParse(col.settings ?? {});
  const settings = settingsParsed.success
    ? settingsParsed.data
    : { label: 'Click', color: '#579bfc', actions: [] };

  const wsRole = await tx.getWorkspaceMemberRole(board.workspaceId, uid);
  const role = resolveBoardRole(board, uid, wsRole);
  const checked = validateButtonActions(
    settings.actions,
    { columns: board.columns, groups: board.groups ?? [], columnLocks: board.columnLocks },
    role,
  );
  if (!checked.ok) {
    throw new HttpsError('failed-precondition', checked.message);
  }

  const patch = buildActionsPatch(settings.actions, item, nowMs);
  // Reads come before the first write: the repeat guard first, then the actor's profile.
  if (
    await tx.hasRecentButtonClick(
      req.boardId,
      req.itemId,
      req.columnId,
      uid,
      nowMs - BUTTON_REPEAT_GUARD_MS,
    )
  ) {
    throw new HttpsError('already-exists', 'You just clicked this button. Try again in a moment.');
  }
  const notify = buildNotifyPlan(settings.actions, req.columnId, settings.label, patch, item);
  const actor = actorOf(uid, await tx.getMemberProfile(board.workspaceId, uid));
  if (Object.keys(patch).length > 0) {
    tx.updateItem(req.boardId, req.itemId, patch, uid, serverTimestamp);
  }
  const activityId = await tx.appendActivity(
    req.boardId,
    activityDoc(actor, 'button_clicked', {
      itemId: req.itemId,
      itemName: item.name,
      columnId: req.columnId,
      columnTitle: settings.label,
      columnType: 'button',
      data: {
        ...(settings.color ? { columnColor: settings.color } : {}),
        ...(settings.actions.length > 0 ? { actions: settings.actions.map((a) => a.type) } : {}),
      },
    }),
  );

  return {
    success: true,
    activityId,
    timestamp: nowMs,
    applied: settings.actions.map((a) => ({ type: a.type })),
    ...(notify ? { notify } : {}),
  };
}

/**
 * The people the `notify` actions name, one entry each (a later action's message wins). Only a
 * plan: the callable sends after the commit, so nothing is delivered if the transaction fails.
 */
function buildNotifyPlan(
  actions: readonly ButtonAction[],
  columnId: string,
  buttonLabel: string,
  patch: Record<string, unknown>,
  item: ItemData,
): ButtonNotifyPlan | null {
  const targets = new Map<string, string>();
  for (const action of actions) {
    if (action.type !== 'notify') continue;
    for (const uid of action.uids) targets.set(uid, action.message?.trim() ?? '');
  }
  if (targets.size === 0) return null;
  return {
    columnId,
    buttonLabel,
    itemName: typeof patch.name === 'string' ? patch.name : item.name,
    targets: [...targets].map(([uid, message]) => ({ uid, message })),
  };
}

/**
 * Merges the actions, in order, into one field-path patch (later actions win on the same key).
 * `move_to_group` only changes `groupId`: the item keeps its position key, which orders it in the
 * target group (ties break on id) because `fractional-indexing` is a web-only dependency.
 */
function buildActionsPatch(
  actions: readonly ButtonAction[],
  item: ItemData,
  nowMs: number,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  let name = item.name;
  for (const [index, action] of actions.entries()) {
    switch (action.type) {
      case 'set_value':
        patch[`values.${action.columnId}`] = action.value ?? null;
        break;
      case 'rename_item': {
        const next = renderRenameTemplate(action.template, name, nowMs);
        if (next.length < 1 || next.length > BUTTON_RENAME_MAX_LENGTH) {
          throw new HttpsError(
            'failed-precondition',
            `Action ${index + 1} (Rename item): the new name must be 1 to ${BUTTON_RENAME_MAX_LENGTH} characters.`,
          );
        }
        name = next;
        patch.name = next;
        break;
      }
      case 'move_to_group':
        patch.groupId = action.groupId;
        break;
      case 'archive_item':
        patch.state = 'archived';
        break;
      case 'notify':
        // Delivered after the commit (see buildNotifyPlan); nothing to write on the item.
        break;
    }
  }
  return patch;
}
