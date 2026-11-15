import { describe, expect, it } from 'vitest';
import { moveItem, moveItemOver } from './reorder';

describe('moveItem', () => {
  it('moves an item to a new position', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 2)).toEqual(['a', 'b', 'd', 'c']);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('clamps at the ends and ignores bad indexes', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 9, 0)).toEqual(['a', 'b']);
  });
  it('does not mutate the input', () => {
    const list = ['a', 'b', 'c'];
    moveItem(list, 0, 2);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('moves over another item by id and keeps the ids', () => {
    const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(moveItemOver(list, (l) => l.id, 3, 1).map((l) => l.id)).toEqual([3, 1, 2]);
    expect(moveItemOver(list, (l) => l.id, 1, 99).map((l) => l.id)).toEqual([1, 2, 3]);
  });
});
