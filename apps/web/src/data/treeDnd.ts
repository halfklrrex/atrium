import { positionAfterAll, positionAtIndex, positionBeforeAll } from '../lib/positions';
import { boardKey, folderKey, type TreeNode } from './boards';

/** Where a dragged sidebar row ends up; each result maps to exactly one document update. */
export type DropResult =
  | { type: 'board'; boardId: string; folderId: string | null; position: string }
  | { type: 'folder'; folderId: string; position: string };

interface Located {
  node: TreeNode;
  parentFolderId: string | null;
  /** Siblings sharing this parent, in display order (folders first, then boards). */
  siblings: TreeNode[];
}

function locate(nodes: readonly TreeNode[]): Map<string, Located> {
  const found = new Map<string, Located>();
  const walk = (list: readonly TreeNode[], parentFolderId: string | null) => {
    for (const node of list) {
      const key = node.type === 'folder' ? folderKey(node.folder.id) : boardKey(node.board.id);
      found.set(key, { node, parentFolderId, siblings: [...list] });
      if (node.type === 'folder') walk(node.children, node.folder.id);
    }
  };
  walk(nodes, null);
  return found;
}

const boardsOf = (nodes: readonly TreeNode[]) =>
  nodes.flatMap((n) => (n.type === 'board' ? [n.board] : []));
const foldersOf = (nodes: readonly TreeNode[]) =>
  nodes.flatMap((n) => (n.type === 'folder' ? [n.folder] : []));

/**
 * Translate "row `activeKey` was dropped on row `overKey`" into a single position/folder update.
 *
 *  - A board dropped on a folder goes to the end of that folder (dropping it on the folder it already
 *    lives in moves it out to the top of the workspace-root boards).
 *  - A board dropped on another board takes that board's place (before it when moving up or between
 *    folders, after it when moving down within the same level).
 *  - A folder dropped on a sibling folder reorders folders at that level. Folders are never nested by
 *    dragging, and a folder dropped on a board is ignored.
 */
export function computeDrop(
  tree: readonly TreeNode[],
  activeKey: string,
  overKey: string,
): DropResult | null {
  if (activeKey === overKey) return null;
  const located = locate(tree);
  const active = located.get(activeKey);
  const over = located.get(overKey);
  if (!active || !over) return null;

  if (active.node.type === 'board') {
    const board = active.node.board;
    if (over.node.type === 'folder') {
      const target = over.node.folder.id;
      if (active.parentFolderId === target) {
        const rootBoards = boardsOf(tree).filter((b) => b.id !== board.id);
        return {
          type: 'board',
          boardId: board.id,
          folderId: null,
          position: positionBeforeAll(rootBoards),
        };
      }
      const inside = boardsOf(over.node.children).filter((b) => b.id !== board.id);
      return {
        type: 'board',
        boardId: board.id,
        folderId: target,
        position: positionAfterAll(inside),
      };
    }

    const overBoard = over.node.board;
    const siblings = boardsOf(over.siblings).filter((b) => b.id !== board.id);
    const overIndex = siblings.findIndex((b) => b.id === overBoard.id);
    const sameLevel = active.parentFolderId === over.parentFolderId;
    const activeIndex = boardsOf(active.siblings).findIndex((b) => b.id === board.id);
    const originalOverIndex = boardsOf(over.siblings).findIndex((b) => b.id === overBoard.id);
    const movingDown = sameLevel && activeIndex < originalOverIndex;
    return {
      type: 'board',
      boardId: board.id,
      folderId: over.parentFolderId,
      position: positionAtIndex(siblings, movingDown ? overIndex + 1 : overIndex),
    };
  }

  // Folders only reorder among folders at the same level.
  if (over.node.type !== 'folder' || active.parentFolderId !== over.parentFolderId) return null;
  const folder = active.node.folder;
  const overFolder = over.node.folder;
  const siblings = foldersOf(over.siblings).filter((f) => f.id !== folder.id);
  const overIndex = siblings.findIndex((f) => f.id === overFolder.id);
  const activeIndex = foldersOf(active.siblings).findIndex((f) => f.id === folder.id);
  const originalOverIndex = foldersOf(over.siblings).findIndex((f) => f.id === overFolder.id);
  const movingDown = activeIndex < originalOverIndex;
  return {
    type: 'folder',
    folderId: folder.id,
    position: positionAtIndex(siblings, movingDown ? overIndex + 1 : overIndex),
  };
}
