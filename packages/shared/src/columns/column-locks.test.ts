import { describe, expect, it } from 'vitest';
import {
  COLUMN_LOCKED_MESSAGE,
  COLUMN_LOCKED_TOOLTIP,
  boardSchema,
  canEditColumn,
  isColumnLocked,
  type TimestampLike,
} from '../index';

const ts = (ms = 1_700_000_000_000): TimestampLike => ({
  seconds: Math.floor(ms / 1000),
  nanoseconds: 0,
  toDate: () => new Date(ms),
  toMillis: () => ms,
});

const baseBoardDoc = {
  workspaceId: 'w1',
  folderId: null,
  name: 'Roadmap',
  description: '',
  kind: 'main',
  access: { u1: 'owner' },
  accessUids: ['u1'],
  position: 'a0',
  icon: null,
  columns: [],
  subitemColumns: [],
  groups: [],
  itemTerminology: 'item',
  state: 'active',
  deletedAt: null,
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
};

describe('isColumnLocked', () => {
  it('returns false when board or columnLocks is missing or empty', () => {
    expect(isColumnLocked(null, 'col_1')).toBe(false);
    expect(isColumnLocked(undefined, 'col_1')).toBe(false);
    expect(isColumnLocked({}, 'col_1')).toBe(false);
    expect(isColumnLocked({ columnLocks: null }, 'col_1')).toBe(false);
    expect(isColumnLocked({ columnLocks: [] }, 'col_1')).toBe(false);
  });

  it('returns true only when columnId is in board.columnLocks', () => {
    const board = { columnLocks: ['col_budget', 'sub_cost'] };
    expect(isColumnLocked(board, 'col_budget')).toBe(true);
    expect(isColumnLocked(board, 'sub_cost')).toBe(true);
    expect(isColumnLocked(board, 'col_notes')).toBe(false);
  });
});

describe('canEditColumn', () => {
  const lockedBoard = { columnLocks: ['col_budget'] };

  it('allows board owners to edit locked and unlocked columns', () => {
    expect(canEditColumn('owner', lockedBoard, 'col_budget')).toBe(true);
    expect(canEditColumn('owner', lockedBoard, 'col_notes')).toBe(true);
  });

  it('denies non-owners when the column is locked and allows them when unlocked', () => {
    expect(canEditColumn('editor', lockedBoard, 'col_budget')).toBe(false);
    expect(canEditColumn('editor', lockedBoard, 'col_notes')).toBe(true);
    expect(canEditColumn('viewer', lockedBoard, 'col_budget')).toBe(false);
    expect(canEditColumn(null, lockedBoard, 'col_budget')).toBe(false);
    expect(canEditColumn(undefined, lockedBoard, 'col_budget')).toBe(false);
  });

  it('treats missing board or missing columnLocks as unlocked', () => {
    expect(canEditColumn('editor', null, 'col_budget')).toBe(true);
    expect(canEditColumn('editor', undefined, 'col_budget')).toBe(true);
    expect(canEditColumn('editor', {}, 'col_budget')).toBe(true);
  });

  it('exports standard lock messages', () => {
    expect(COLUMN_LOCKED_MESSAGE).toBe('This column is locked. Only board owners can edit it.');
    expect(COLUMN_LOCKED_TOOLTIP).toBe('Only board owners can edit this column');
  });
});

describe('boardSchema columnLocks', () => {
  it('defaults columnLocks to [] when omitted (legacy boards)', () => {
    const parsed = boardSchema.parse(baseBoardDoc);
    expect(parsed.columnLocks).toEqual([]);
  });

  it('accepts valid unique slug IDs up to 200 entries', () => {
    const locks = Array.from({ length: 200 }, (_, i) => `col_${i}`);
    const parsed = boardSchema.parse({ ...baseBoardDoc, columnLocks: locks });
    expect(parsed.columnLocks).toEqual(locks);
  });

  it('rejects duplicate column lock IDs', () => {
    const res = boardSchema.safeParse({
      ...baseBoardDoc,
      columnLocks: ['col_a', 'col_b', 'col_a'],
    });
    expect(res.success).toBe(false);
  });

  it('rejects more than 200 column lock IDs', () => {
    const locks = Array.from({ length: 201 }, (_, i) => `col_${i}`);
    const res = boardSchema.safeParse({
      ...baseBoardDoc,
      columnLocks: locks,
    });
    expect(res.success).toBe(false);
  });

  it('rejects invalid slug IDs in columnLocks', () => {
    const res = boardSchema.safeParse({
      ...baseBoardDoc,
      columnLocks: ['invalid slug!'],
    });
    expect(res.success).toBe(false);
  });
});
