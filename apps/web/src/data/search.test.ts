import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem } from '../test/fixtures';
import { searchItems } from './search';

vi.mock('../lib/firebase', () => ({ db: {} }));

const calls: { boardId: string; word: string; count: number }[] = [];
let inFlight = 0;
let maxInFlight = 0;
let failing = new Set<string>();
let answers: Record<string, string[]> = {};

vi.mock('./firestore', () => ({
  queries: {
    itemsByNameToken: (boardId: string, word: string, count: number) => ({ boardId, word, count }),
  },
}));
vi.mock('firebase/firestore', () => ({
  getDocs: async (q: { boardId: string; word: string; count: number }) => {
    calls.push(q);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    if (failing.has(q.boardId)) throw new Error('permission-denied');
    return {
      docs: (answers[q.boardId] ?? []).map((name, i) => ({
        data: () => makeItem({ id: `${q.boardId}-${i}`, name }),
      })),
    };
  },
}));

const boards = (n: number) => Array.from({ length: n }, (_, i) => makeBoard({ id: `b${i}` }));
const live = () => new AbortController().signal;

describe('searchItems', () => {
  it('queries the longest word on every board, 10 at a time, 10 items each', async () => {
    calls.length = 0;
    maxInFlight = 0;
    failing = new Set();
    answers = {};
    const outcome = await searchItems(boards(25), 'ab pipeline', live(), () => {});
    expect(outcome).toEqual({ total: 25, failed: 0 });
    expect(calls).toHaveLength(25);
    expect(calls.every((c) => c.word === 'pipeline' && c.count === 10)).toBe(true);
    expect(maxInFlight).toBe(10);
  });

  it('keeps only items where every word matches, streaming per board', async () => {
    answers = { b0: ['Ship pipeline', 'Pipeline cleanup'], b1: ['Pipeline'] };
    failing = new Set();
    const seen: string[] = [];
    await searchItems(boards(2), 'pipeline ship', live(), (b, items) =>
      seen.push(`${b.id}:${items.map((i) => i.name).join(',')}`),
    );
    expect(seen).toEqual(['b0:Ship pipeline']);
  });

  it('does not query for a single character', async () => {
    calls.length = 0;
    const outcome = await searchItems(boards(3), 'a', live(), () => {});
    expect(calls).toHaveLength(0);
    expect(outcome.failed).toBe(0);
  });

  it('counts failed boards and keeps the others', async () => {
    failing = new Set(['b1']);
    answers = { b0: ['Pipeline'] };
    const seen: string[] = [];
    const outcome = await searchItems(boards(2), 'pipeline', live(), (b) => seen.push(b.id));
    expect(outcome).toEqual({ total: 2, failed: 1 });
    expect(seen).toEqual(['b0']);
  });

  it('delivers nothing after an abort', async () => {
    failing = new Set();
    answers = { b0: ['Pipeline'], b1: ['Pipeline'] };
    const controller = new AbortController();
    const seen: string[] = [];
    const run = searchItems(boards(30), 'pipeline', controller.signal, (b) => seen.push(b.id), 1);
    controller.abort();
    await run;
    expect(seen).toEqual([]);
  });
});
