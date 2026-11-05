import { positionAfterAll, positionAtIndex, positionBeforeAll } from '../lib/positions';
import { nodeKey, type LeafNode, type TreeNode } from './boards';

/** Where a dragged sidebar row ends up; each result maps to exactly one document update. */
export type DropResult =
  | { type: 'board'; boardId: string; folderId: string | null; position: string }
  | { type: 'dashboard'; dashboardId: string; folderId: string | null; position: string }
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
      const key = nodeKey(node);
      found.set(key, { node, parentFolderId, siblings: [...list] });
      if (node.type === 'folder') walk(node.children, node.folder.id);
    }
  };
  walk(nodes, null);
  return found;
}

/** Boards and dashboards share one position order inside a folder, so both count as leaves. */
const leafId = (n: LeafNode): string => (n.type === 'board' ? n.board.id : n.dashboard.id);
const leafOf = (n: LeafNode): { id: string; position: string } =>
  n.type === 'board' ? n.board : n.dashboard;
const leavesOf = (nodes: readonly TreeNode[]): LeafNode[] =>
  nodes.filter((n): n is LeafNode => n.type !== 'folder');
const leafDrop = (node: LeafNode, folderId: string | null, position: string): DropResult =>
  node.type === 'board'
    ? { type: 'board', boardId: node.board.id, folderId, position }
    : { type: 'dashboard', dashboardId: node.dashboard.id, folderId, position };
const foldersOf = (nodes: readonly TreeNode[]) =>
  nodes.flatMap((n) => (n.type === 'folder' ? [n.folder] : []));

/**
 * Translate "row `activeKey` was dropped on row `overKey`" into a single position/folder update.
 *
 *  - A board or dashboard dropped on a folder goes to the end of that folder (dropping it on the folder it already
 *    lives in moves it out to the top of the workspace-root boards).
 *  - A board or dashboard dropped on another leaf takes its place (before it when moving up or between
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

  if (active.node.type !== 'folder') {
    const moving = active.node;
    const movingId = leafId(moving);
    const others = (nodes: readonly TreeNode[]) =>
      leavesOf(nodes)
        .filter((n) => leafId(n) !== movingId)
        .map(leafOf);
    if (over.node.type === 'folder') {
      const target = over.node.folder.id;
      if (active.parentFolderId === target) {
        return leafDrop(moving, null, positionBeforeAll(others(tree)));
      }
      return leafDrop(moving, target, positionAfterAll(others(over.node.children)));
    }

    const overId = leafId(over.node);
    const siblings = others(over.siblings);
    const overIndex = siblings.findIndex((b) => b.id === overId);
    const sameLevel = active.parentFolderId === over.parentFolderId;
    const activeIndex = leavesOf(active.siblings).findIndex((n) => leafId(n) === movingId);
    const originalOverIndex = leavesOf(over.siblings).findIndex((n) => leafId(n) === overId);
    const movingDown = sameLevel && activeIndex < originalOverIndex;
    return leafDrop(
      moving,
      over.parentFolderId,
      positionAtIndex(siblings, movingDown ? overIndex + 1 : overIndex),
    );
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
