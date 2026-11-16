import { describe, expect, it } from 'vitest';
import { ITEM_ROW_ESTIMATE, SUBITEM_ROW_ESTIMATE, estimateEntryHeight } from './table-model';

describe('estimateEntryHeight (virtualised group row heights)', () => {
  it('is one row when the block is closed, whatever the subitem count', () => {
    expect(estimateEntryHeight(false, 0)).toBe(ITEM_ROW_ESTIMATE);
    expect(estimateEntryHeight(false, 7)).toBe(ITEM_ROW_ESTIMATE);
  });

  it('adds the block header, every subitem row and "+ Add subitem" when open', () => {
    expect(estimateEntryHeight(true, 0)).toBe(ITEM_ROW_ESTIMATE + 2 * SUBITEM_ROW_ESTIMATE);
    expect(estimateEntryHeight(true, 4)).toBe(ITEM_ROW_ESTIMATE + 6 * SUBITEM_ROW_ESTIMATE);
  });

  it('pushes the next row down by exactly the block height as subitems are added', () => {
    const before = estimateEntryHeight(true, 4);
    expect(estimateEntryHeight(true, 5) - before).toBe(SUBITEM_ROW_ESTIMATE);
  });

  it('matches the CSS tokens (36px item rows, 32px subitem rows)', () => {
    expect(ITEM_ROW_ESTIMATE).toBe(36);
    expect(SUBITEM_ROW_ESTIMATE).toBe(32);
  });
});
