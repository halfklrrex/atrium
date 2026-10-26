import { describe, expect, it } from 'vitest';
import { makeBoard, makeFolder } from '../test/fixtures';
import { buildTree } from './boards';
import { computeDrop } from './treeDnd';

const folders = [
  makeFolder({ id: 'f1', position: 'a0' }),
  makeFolder({ id: 'f2', position: 'a1' }),
];
const boards = [
  makeBoard({ id: 'r1', position: 'a0' }),
  makeBoard({ id: 'r2', position: 'a1' }),
  makeBoard({ id: 'r3', position: 'a2' }),
  makeBoard({ id: 'in1', folderId: 'f1', position: 'a0' }),
  makeBoard({ id: 'in2', folderId: 'f1', position: 'a1' }),
];
const tree = buildTree(folders, boards);

describe('computeDrop', () => {
  it('returns nothing when dropped on itself or on unknown rows', () => {
    expect(computeDrop(tree, 'board:r1', 'board:r1')).toBeNull();
    expect(computeDrop(tree, 'board:r1', 'board:nope')).toBeNull();
  });

  it('moves a board down within a level: lands after the target', () => {
    const drop = computeDrop(tree, 'board:r1', 'board:r2');
    expect(drop).toMatchObject({ type: 'board', boardId: 'r1', folderId: null });
    // between r2 (a1) and r3 (a2)
    expect(drop?.position && drop.position > 'a1' && drop.position < 'a2').toBe(true);
  });

  it('moves a board up within a level: lands before the target', () => {
    const drop = computeDrop(tree, 'board:r3', 'board:r2');
    expect(drop).toMatchObject({ type: 'board', boardId: 'r3', folderId: null });
    expect(drop?.position && drop.position > 'a0' && drop.position < 'a1').toBe(true);
  });

  it('drops a board onto a folder: end of that folder', () => {
    const drop = computeDrop(tree, 'board:r1', 'folder:f1');
    expect(drop).toMatchObject({ type: 'board', boardId: 'r1', folderId: 'f1' });
    expect(drop?.position && drop.position > 'a1').toBe(true);
  });

  it('drops a board onto its own folder: moves it out to the top of the root boards', () => {
    const drop = computeDrop(tree, 'board:in1', 'folder:f1');
    expect(drop).toMatchObject({ type: 'board', boardId: 'in1', folderId: null });
    expect(drop?.position && drop.position < 'a0').toBe(true);
  });

  it('drops a board onto a board inside a folder: joins that folder before it', () => {
    const drop = computeDrop(tree, 'board:r1', 'board:in2');
    expect(drop).toMatchObject({ type: 'board', boardId: 'r1', folderId: 'f1' });
    expect(drop?.position && drop.position > 'a0' && drop.position < 'a1').toBe(true);
  });

  it('reorders folders among folders and refuses to nest or cross levels', () => {
    const drop = computeDrop(tree, 'folder:f1', 'folder:f2');
    expect(drop).toMatchObject({ type: 'folder', folderId: 'f1' });
    expect(drop?.position && drop.position > 'a1').toBe(true);
    expect(computeDrop(tree, 'folder:f1', 'board:r1')).toBeNull();
    expect(computeDrop(tree, 'folder:f1', 'board:in1')).toBeNull();
  });
});
