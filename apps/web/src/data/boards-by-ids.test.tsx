import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../test/fixtures';
import { useBoardsByIds } from './hooks';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (snap: unknown) => void>(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('./firestore', () => ({
  queries: {},
  refs: { board: (id: string) => ({ id }) },
}));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  onSnapshot: (ref: { id: string }, next: (snap: unknown) => void) => {
    mocks.subscribe(ref.id);
    mocks.listeners.set(ref.id, next);
    return () => mocks.unsubscribe(ref.id);
  },
}));

const deliver = (id: string) =>
  mocks.listeners.get(id)!({ exists: () => true, data: () => makeBoard({ id, name: id }) });

describe('useBoardsByIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
  });

  it('keeps entries and subscriptions when the same ids come in a new order', () => {
    const { result, rerender } = renderHook(({ ids }) => useBoardsByIds(ids), {
      initialProps: { ids: ['a', 'b'] },
    });
    act(() => {
      deliver('a');
      deliver('b');
    });
    expect(result.current.loading).toBe(false);
    expect(Object.keys(result.current.boards).sort()).toEqual(['a', 'b']);
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);

    rerender({ ids: ['b', 'a'] });
    expect(result.current.loading).toBe(false);
    expect(Object.keys(result.current.boards).sort()).toEqual(['a', 'b']);
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it('adds and removes only the difference', () => {
    const { result, rerender } = renderHook(({ ids }) => useBoardsByIds(ids), {
      initialProps: { ids: ['a', 'b'] },
    });
    act(() => {
      deliver('a');
      deliver('b');
    });
    rerender({ ids: ['b', 'c'] });
    expect(mocks.unsubscribe).toHaveBeenCalledWith('a');
    expect(mocks.subscribe).toHaveBeenLastCalledWith('c');
    expect(result.current.loading).toBe(true);
    expect(Object.keys(result.current.boards)).toEqual(['b']);
  });
});
