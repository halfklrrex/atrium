import { beforeEach, describe, expect, it } from 'vitest';
import { useTableStore } from './table-store';

const order = ['a', 'b', 'c', 'd', 'e'];
const store = () => useTableStore.getState();
const selected = () => [...store().selected].sort();

describe('table store range selection', () => {
  beforeEach(() => store().reset('b1'));

  it('sets the anchor on a plain toggle, also when deselecting', () => {
    store().toggleSelected('b');
    expect(store().anchorId).toBe('b');
    store().toggleSelected('b');
    expect(store().anchorId).toBe('b');
    expect(selected()).toEqual([]);
  });

  it('selects the rows from the anchor to the clicked row and keeps the anchor', () => {
    store().toggleSelected('b');
    store().selectRange(order, 'd');
    expect(selected()).toEqual(['b', 'c', 'd']);
    expect(store().anchorId).toBe('b');
    store().selectRange(order, 'a');
    expect(selected()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('adds to the selection and never removes', () => {
    store().setSelected(new Set(['e']));
    store().toggleSelected('a');
    store().selectRange(order, 'b');
    expect(selected()).toEqual(['a', 'b', 'e']);
  });

  it('is a plain toggle without a usable anchor', () => {
    store().selectRange(order, 'c');
    expect(selected()).toEqual(['c']);
    expect(store().anchorId).toBe('c');
    store().selectRange(['x', 'y'], 'y');
    expect(selected()).toEqual(['c', 'y']);
    expect(store().anchorId).toBe('y');
  });

  it('keeps the anchor on group select-all and clears it on clearSelection and reset', () => {
    store().toggleSelected('a');
    store().setGroupSelected(['c', 'd'], true);
    expect(store().anchorId).toBe('a');
    store().clearSelection();
    expect(store().anchorId).toBeNull();
    store().toggleSelected('a');
    store().reset('b2');
    expect(store().anchorId).toBeNull();
  });
});

describe('table store bulk column', () => {
  beforeEach(() => store().reset('b1'));

  it('sets and clears the outlined column, and clearSelection and reset drop it', () => {
    expect(store().bulkColumnId).toBeNull();
    store().setBulkColumn('status');
    expect(store().bulkColumnId).toBe('status');
    store().setBulkColumn(null);
    expect(store().bulkColumnId).toBeNull();
    store().setBulkColumn('status');
    store().clearSelection();
    expect(store().bulkColumnId).toBeNull();
    store().setBulkColumn('status');
    store().reset('b2');
    expect(store().bulkColumnId).toBeNull();
  });
});
