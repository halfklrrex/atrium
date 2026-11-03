import { describe, expect, it } from 'vitest';
import { favoritePositionFor, moveId } from './favorites-order';

const favs = [
  { id: 'a', boardId: 'a', position: 'a0' },
  { id: 'h', boardId: 'h', position: 'a1' }, // hidden
  { id: 'b', boardId: 'b', position: 'a2' },
  { id: 'c', boardId: 'c', position: 'a3' },
];
const visible = ['a', 'b', 'c'];

describe('favoritePositionFor', () => {
  it('moves to the top before every favourite, hidden ones included', () => {
    expect(favoritePositionFor(favs, visible, 'c', 0) < 'a0').toBe(true);
  });
  it('moves to the end after every favourite', () => {
    expect(favoritePositionFor(favs, visible, 'a', 2) > 'a3').toBe(true);
  });
  it('lands right after the visible anchor, before the next full-list neighbour', () => {
    const key = favoritePositionFor(favs, visible, 'c', 1); // between a and b (hidden h sits between)
    expect(key > 'a0' && key < 'a1').toBe(true);
  });
  it('moving down one step goes between the next two neighbours', () => {
    const key = favoritePositionFor(favs, visible, 'a', 1); // after b, before c
    expect(key > 'a2' && key < 'a3').toBe(true);
  });
});

describe('moveId', () => {
  it('moves and clamps', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 'c', -4)).toEqual(['c', 'a', 'b']);
  });
});
