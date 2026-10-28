import {
  type BoardKind,
  type BoardRole,
  type ClickButtonRequest,
  type ClickButtonResult,
  type StartTimeTrackingRequest,
  type StartTimeTrackingResult,
  type StopTimeTrackingRequest,
  type StopTimeTrackingResult,
  type TimeTrackingValue,
  type WorkspaceRole,
  COLUMN_LOCKED_MESSAGE,
  buttonSettingsSchema,
  canEditBoard,
  canEditColumn,
  resolveBoardRole,
  startTimer,
  stopTimer,
  timeTrackingValueSchema,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

export interface BoardData {
  kind: BoardKind;
  workspaceId: string;
  access: Record<string, BoardRole>;
  columns: Array<{ id: string; type: string; settings?: unknown }>;
  columnLocks?: string[];
}

export interface ItemData {
  id: string;
  name: string;
  state: 'active' | 'archived' | 'deleted';
  values: Record<string, unknown>;
}

export interface ActivityAppendData {
  kind: 'button_clicked';
  itemId: string;
  columnId: string;
  userId: string;
  createdAt: unknown;
  data: {
    itemName: string;
    columnLabel: string;
    columnColor?: string;
  };
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
  appendActivity(boardId: string, activity: ActivityAppendData): Promise<string>;
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

export async function clickButtonInTransaction(
  tx: ColumnActionsTx,
  uid: string,
  req: ClickButtonRequest,
  serverTimestamp: unknown,
): Promise<ClickButtonResult> {
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
    : { label: 'Click', color: '#579bfc' };

  const activityData: { itemName: string; columnLabel: string; columnColor?: string } = {
    itemName: item.name,
    columnLabel: settings.label,
  };
  if (settings.color) {
    activityData.columnColor = settings.color;
  }

  const activityId = await tx.appendActivity(req.boardId, {
    kind: 'button_clicked',
    itemId: req.itemId,
    columnId: req.columnId,
    userId: uid,
    createdAt: serverTimestamp,
    data: activityData,
  });

  return { success: true, activityId, timestamp: nowMs };
}
