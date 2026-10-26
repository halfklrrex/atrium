import { describe, expect, it } from 'vitest';
import type { BoardViewDoc } from './model';
import { mergeViews, syntheticMainView } from './views';

const view = (id: string, position: string, ownerId: string | null = null): BoardViewDoc => ({
  ...syntheticMainView(),
  id,
  name: id,
  position,
  ownerId,
  synthetic: undefined,
});

describe('mergeViews', () => {
  it('synthesises main first when it was never saved', () => {
    const merged = mergeViews([view('b', 'a2'), view('a', 'a1')], [], 'u1');
    expect(merged.map((v) => v.id)).toEqual(['main', 'a', 'b']);
    expect(merged[0]?.synthetic).toBe(true);
  });

  it('keeps a stored main in front, whatever its position', () => {
    const merged = mergeViews([view('a', 'a0'), view('main', 'a0')], [], 'u1');
    expect(merged.map((v) => v.id)).toEqual(['main', 'a']);
    expect(merged[0]?.synthetic).toBeFalsy();
  });

  it('merges own personal views by position and drops other users personal ones', () => {
    const merged = mergeViews(
      [view('s1', 'a1'), view('s2', 'a3')],
      [view('mine', 'a2', 'u1'), view('theirs', 'a2', 'u2')],
      'u1',
    );
    expect(merged.map((v) => v.id)).toEqual(['main', 's1', 'mine', 's2']);
  });
});
