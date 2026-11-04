import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem } from '../test/fixtures';
import { boardsToListen, combineDashboardItems } from './dashboard-items';

vi.mock('../lib/firebase', () => ({ db: {} }));

describe('boardsToListen', () => {
  it('dedupes and keeps the order', () => {
    expect(boardsToListen(['b', 'a', 'b'])).toEqual({ ids: ['b', 'a'], truncatedFrom: 0 });
  });

  it('caps and reports the requested count', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `b${i}`);
    expect(boardsToListen(ids, 3)).toEqual({ ids: ['b0', 'b1', 'b2'], truncatedFrom: 5 });
    expect(boardsToListen(ids, 5).truncatedFrom).toBe(0);
  });
});

describe('combineDashboardItems', () => {
  const b1 = makeBoard({ id: 'b1' });
  const b2 = makeBoard({ id: 'b2' });
  const i1 = makeItem({ id: 'i1' });
  const i2 = makeItem({ id: 'i2' });

  it('combines readable boards in the requested order', () => {
    const out = combineDashboardItems({
      ids: ['b2', 'b1'],
      boardDocs: { b1, b2 },
      items: { b1: [i1], b2: [i2] },
      failedItems: [],
    });
    expect(out.boards.map((b) => b.board.id)).toEqual(['b2', 'b1']);
    expect(out.boards[0]?.items).toEqual([i2]);
    expect(out.pending).toBe(false);
    expect(out.unreadableBoardIds).toEqual([]);
  });

  it('reports a board that is missing or unreadable (null) instead of throwing', () => {
    const out = combineDashboardItems({
      ids: ['b1', 'b2'],
      boardDocs: { b1, b2: null },
      items: { b1: [i1] },
      failedItems: [],
    });
    expect(out.boards.map((b) => b.board.id)).toEqual(['b1']);
    expect(out.unreadableBoardIds).toEqual(['b2']);
    expect(out.pending).toBe(false);
  });

  it('reports a board whose item listener was refused', () => {
    const out = combineDashboardItems({
      ids: ['b1', 'b2'],
      boardDocs: { b1, b2 },
      items: { b1: [i1] },
      failedItems: ['b2'],
    });
    expect(out.unreadableBoardIds).toEqual(['b2']);
    expect(out.boards).toHaveLength(1);
    expect(out.pending).toBe(false);
  });

  it('leaves archived and deleted boards out and lists them separately', () => {
    const archived = makeBoard({ id: 'b2', state: 'archived' });
    const out = combineDashboardItems({
      ids: ['b1', 'b2'],
      boardDocs: { b1, b2: archived },
      items: { b1: [i1] },
      failedItems: [],
    });
    expect(out.inactiveBoardIds).toEqual(['b2']);
    expect(out.unreadableBoardIds).toEqual([]);
    expect(out.pending).toBe(false);
  });

  it('is pending until the boards and their items have answered', () => {
    expect(
      combineDashboardItems({ ids: ['b1'], boardDocs: {}, items: {}, failedItems: [] }).pending,
    ).toBe(true);
    expect(
      combineDashboardItems({ ids: ['b1'], boardDocs: { b1 }, items: {}, failedItems: [] }).pending,
    ).toBe(true);
    expect(
      combineDashboardItems({ ids: ['b1'], boardDocs: { b1 }, items: { b1: [] }, failedItems: [] })
        .pending,
    ).toBe(false);
  });

  it('handles no boards', () => {
    const out = combineDashboardItems({ ids: [], boardDocs: {}, items: {}, failedItems: [] });
    expect(out).toEqual({
      boards: [],
      unreadableBoardIds: [],
      inactiveBoardIds: [],
      pending: false,
    });
  });
});
