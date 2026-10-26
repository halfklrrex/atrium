import { describe, expect, it } from 'vitest';
import { defaultSubitemColumns, isSubitem, subitemsByParent } from './subitems';

describe('defaultSubitemColumns', () => {
  it('returns Owner, Status and Date with unique ids and ordered positions', () => {
    const cols = defaultSubitemColumns();
    expect(cols.map((c) => [c.title, c.type])).toEqual([
      ['Owner', 'people'],
      ['Status', 'status'],
      ['Date', 'date'],
    ]);
    expect(new Set(cols.map((c) => c.id)).size).toBe(3);
    expect(cols.map((c) => c.position)).toEqual(['a0', 'a1', 'a2']);
    const status = cols[1]?.settings as { labels: { label: string }[] };
    expect(status.labels.map((l) => l.label)).toContain('Working on it');
  });
});

describe('default subitem column ids', () => {
  it('uses sub_* ids, which differ from the board defaults', () => {
    expect(defaultSubitemColumns().map((c) => c.id)).toEqual([
      'sub_owner',
      'sub_status',
      'sub_date',
    ]);
  });
  it('avoids ids already used by the board columns', () => {
    const ids = defaultSubitemColumns(['sub_status', 'sub_owner', 'status']).map((c) => c.id);
    expect(ids).toEqual(['sub_owner_2', 'sub_status_2', 'sub_date']);
  });
});

describe('subitem helpers', () => {
  const item = (id: string, parentItemId: string | null, position: string) => ({
    id,
    parentItemId,
    position,
  });
  it('detects subitems', () => {
    expect(isSubitem({ parentItemId: null })).toBe(false);
    expect(isSubitem({ parentItemId: 'p' })).toBe(true);
  });
  it('groups by parent sorted by position', () => {
    const map = subitemsByParent([
      item('p', null, 'a0'),
      item('s2', 'p', 'a2'),
      item('s1', 'p', 'a1'),
      item('t1', 'q', 'a0'),
    ]);
    expect(map.get('p')?.map((i) => i.id)).toEqual(['s1', 's2']);
    expect(map.get('q')?.map((i) => i.id)).toEqual(['t1']);
    expect(map.size).toBe(2);
  });
});
