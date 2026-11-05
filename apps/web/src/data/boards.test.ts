import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeDashboard, makeFolder } from '../test/fixtures';
import {
  activeBoards,
  buildTree,
  dashboardKey,
  filterTree,
  flattenTree,
  mergeBoards,
} from './boards';

vi.mock('../lib/firebase', () => ({ db: {} }));

const names = (nodes: ReturnType<typeof buildTree>) =>
  nodes.map((n) =>
    n.type === 'folder'
      ? `[${n.folder.id}]`
      : n.type === 'dashboard'
        ? `dash:${n.dashboard.id}`
        : n.board.id,
  );

describe('mergeBoards (main boards + boards I have access to)', () => {
  it('dedupes a board that both listeners return, keeping the latest snapshot', () => {
    const stale = makeBoard({ id: 'b1', name: 'Old name', kind: 'main' });
    const fresh = makeBoard({ id: 'b1', name: 'New name', kind: 'main' });
    const merged = mergeBoards([stale], [fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe('New name');
  });

  it('unions private boards (accessUids) with main boards, ordered by position', () => {
    const main = [makeBoard({ id: 'm1', position: 'a2' }), makeBoard({ id: 'm2', position: 'a0' })];
    const mine = [
      makeBoard({ id: 'p1', kind: 'private', position: 'a1' }),
      makeBoard({ id: 'm2', position: 'a0' }),
    ];
    expect(mergeBoards(main, mine).map((b) => b.id)).toEqual(['m2', 'p1', 'm1']);
  });

  it('handles empty listeners', () => {
    expect(mergeBoards([], [])).toEqual([]);
  });

  it('hides archived and deleted boards from lists', () => {
    const boards = [
      makeBoard({ id: 'a' }),
      makeBoard({ id: 'b', state: 'archived' }),
      makeBoard({ id: 'c', state: 'deleted' }),
    ];
    expect(activeBoards(boards).map((b) => b.id)).toEqual(['a']);
  });
});

describe('buildTree', () => {
  const folders = [
    makeFolder({ id: 'f2', position: 'a1' }),
    makeFolder({ id: 'f1', position: 'a0' }),
    makeFolder({ id: 'sub', parentFolderId: 'f1', position: 'a0' }),
  ];
  const boards = [
    makeBoard({ id: 'root2', position: 'a1' }),
    makeBoard({ id: 'root1', position: 'a0' }),
    makeBoard({ id: 'inF1', folderId: 'f1' }),
    makeBoard({ id: 'inSub', folderId: 'sub' }),
  ];

  it('puts folders first, then boards, each by position', () => {
    expect(names(buildTree(folders, boards))).toEqual(['[f1]', '[f2]', 'root1', 'root2']);
  });

  it('nests sub-folders and boards, and counts boards recursively', () => {
    const f1 = buildTree(folders, boards)[0];
    if (f1?.type !== 'folder') throw new Error('expected folder');
    expect(names(f1.children)).toEqual(['[sub]', 'inF1']);
    expect(f1.boardCount).toBe(2);
  });

  it('shows boards pointing at a missing folder at the root', () => {
    const tree = buildTree([], [makeBoard({ id: 'orphan', folderId: 'gone' })]);
    expect(names(tree)).toEqual(['orphan']);
  });

  it('keeps only one level of nesting: deeper folders surface at the root', () => {
    const deep = [
      makeFolder({ id: 'a' }),
      makeFolder({ id: 'b', parentFolderId: 'a' }),
      makeFolder({ id: 'c', parentFolderId: 'b' }),
    ];
    expect(names(buildTree(deep, []))).toEqual(['[a]', '[c]']);
  });

  it('flattens only expanded folders', () => {
    const tree = buildTree(folders, boards);
    expect(flattenTree(tree, new Set()).map((r) => r.key)).toEqual([
      'folder:f1',
      'folder:f2',
      'board:root1',
      'board:root2',
    ]);
    const open = flattenTree(tree, new Set(['f1']));
    expect(open.map((r) => [r.key, r.depth])).toContainEqual(['board:inF1', 1]);
    expect(open.find((r) => r.key === 'board:inF1')?.parentFolderId).toBe('f1');
  });

  it('filters boards by name and keeps their folders', () => {
    const tree = buildTree(
      [makeFolder({ id: 'f1' })],
      [
        makeBoard({ id: 'x', name: 'Roadmap', folderId: 'f1' }),
        makeBoard({ id: 'y', name: 'Budget' }),
      ],
    );
    expect(names(filterTree(tree, 'road'))).toEqual(['[f1]']);
    expect(names(filterTree(tree, 'zzz'))).toEqual([]);
    expect(filterTree(tree, '  ')).toHaveLength(2);
  });
});

describe('buildTree with dashboards', () => {
  const folders = [makeFolder({ id: 'f1', position: 'a0' })];
  const boards = [
    makeBoard({ id: 'b1', position: 'a0' }),
    makeBoard({ id: 'b2', position: 'a2' }),
    makeBoard({ id: 'inF', folderId: 'f1', position: 'a0' }),
  ];
  const dashboards = [
    makeDashboard({ id: 'd1', position: 'a1' }),
    makeDashboard({ id: 'dIn', folderId: 'f1', position: 'a1' }),
    makeDashboard({ id: 'dGone', folderId: 'missing', position: 'a3' }),
  ];

  it('interleaves boards and dashboards by position after the folders', () => {
    expect(names(buildTree(folders, boards, dashboards))).toEqual([
      '[f1]',
      'b1',
      'dash:d1',
      'b2',
      'dash:dGone',
    ]);
  });

  it('nests dashboards in folders without counting them as boards', () => {
    const f1 = buildTree(folders, boards, dashboards)[0];
    if (f1?.type !== 'folder') throw new Error('expected folder');
    expect(names(f1.children)).toEqual(['inF', 'dash:dIn']);
    expect(f1.boardCount).toBe(1);
  });

  it('keeps working without dashboards', () => {
    expect(names(buildTree(folders, boards))).toEqual(['[f1]', 'b1', 'b2']);
  });

  it('flattens dashboard rows with a dashboard key', () => {
    const rows = flattenTree(buildTree(folders, boards, dashboards), new Set(['f1']));
    expect(rows.map((r) => r.key)).toContain(dashboardKey('dIn'));
    expect(rows.find((r) => r.key === 'dashboard:d1')?.parentFolderId).toBeNull();
    expect(rows.find((r) => r.key === 'dashboard:dIn')).toMatchObject({
      depth: 1,
      parentFolderId: 'f1',
    });
  });

  it('filters dashboards by name', () => {
    const tree = buildTree([], boards, [
      makeDashboard({ id: 'd1', name: 'Team overview' }),
      makeDashboard({ id: 'd2', name: 'Budget' }),
    ]);
    expect(names(filterTree(tree, 'overv'))).toEqual(['dash:d1']);
  });
});
