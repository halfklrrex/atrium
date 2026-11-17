import { describe, expect, it } from 'vitest';
import { fitVisibleTabs } from './view-tabs-overflow';

const ids = ['a', 'b', 'c', 'd', 'e'];
const widths = new Map(ids.map((id) => [id, 100]));
const base = { ids, widths, moreWidth: 80, gap: 4 };

describe('fitVisibleTabs', () => {
  it('shows every tab when they all fit, without reserving room for More', () => {
    expect(fitVisibleTabs({ ...base, available: 520, activeId: 'a' })).toEqual(ids);
  });

  it('takes tabs from the left while they fit next to the More trigger', () => {
    // budget 400 - 80 - 4 = 316: a (100) + b (104) + c (104) = 308
    expect(fitVisibleTabs({ ...base, available: 400, activeId: 'a' })).toEqual(['a', 'b', 'c']);
  });

  it('swaps the selected view in when it would be hidden, keeping the order', () => {
    expect(fitVisibleTabs({ ...base, available: 400, activeId: 'e' })).toEqual(['a', 'b', 'e']);
  });

  it('keeps only the selected view when nothing else fits', () => {
    expect(fitVisibleTabs({ ...base, available: 120, activeId: 'd' })).toEqual(['d']);
  });

  it('never returns an empty row', () => {
    expect(fitVisibleTabs({ ...base, available: 10, activeId: 'a' })).toEqual(['a']);
  });
});
