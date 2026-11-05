import { comparePositions } from '../lib/positions';
import type { BoardDoc, DashboardDoc, FolderDoc } from './model';

/**
 * Merge the board lists returned by the two listing queries (main boards of the workspace, and
 * boards listing me in `accessUids`). A main board I also have explicit access to appears in both;
 * it is kept once, from the last list that mentions it (the freshest snapshot wins).
 */
export function mergeBoards(...lists: readonly (readonly BoardDoc[])[]): BoardDoc[] {
  const byId = new Map<string, BoardDoc>();
  for (const list of lists) for (const board of list) byId.set(board.id, board);
  return [...byId.values()].sort(comparePositions);
}

/** Boards that should show up in lists: archived and deleted ones are hidden. */
export function activeBoards(boards: readonly BoardDoc[]): BoardDoc[] {
  return boards.filter((b) => b.state === 'active');
}

/** Boards that were archived by a member. */
export function archivedBoards(boards: readonly BoardDoc[]): BoardDoc[] {
  return boards.filter((b) => b.state === 'archived');
}

/** Boards moved to trash (soft-deleted). */
export function deletedBoards(boards: readonly BoardDoc[]): BoardDoc[] {
  return boards.filter((b) => b.state === 'deleted');
}

export interface FolderNode {
  type: 'folder';
  folder: FolderDoc;
  children: TreeNode[];
  /** Boards directly inside, plus those in sub-folders. */
  boardCount: number;
}

export interface BoardNode {
  type: 'board';
  board: BoardDoc;
}

export interface DashboardNode {
  type: 'dashboard';
  dashboard: DashboardDoc;
}

export type TreeNode = FolderNode | BoardNode | DashboardNode;

/** A tree leaf: a board or a dashboard (they share one position order inside a folder). */
export type LeafNode = BoardNode | DashboardNode;

const leafPosition = (n: LeafNode): { id: string; position: string } =>
  n.type === 'board' ? n.board : n.dashboard;

/**
 * Sidebar / content tree of a workspace: folders first at each level, then boards, each ordered by
 * `position`. Only one level of nesting is supported, so a folder whose parent is missing or is
 * itself nested is shown at the root, and so is a board or dashboard pointing at a folder that no
 * longer exists. Boards and dashboards are interleaved by `position`.
 */
export function buildTree(
  folders: readonly FolderDoc[],
  boards: readonly BoardDoc[],
  dashboards: readonly DashboardDoc[] = [],
): TreeNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parentOf = (f: FolderDoc): string | null => {
    const parent = f.parentFolderId ? byId.get(f.parentFolderId) : undefined;
    return parent && parent.parentFolderId === null ? parent.id : null;
  };

  const effectiveFolder = (id: string | null): string | null =>
    id !== null && byId.has(id) ? id : null;
  const leavesIn = (folderId: string | null): LeafNode[] => [
    ...boards
      .filter((b) => effectiveFolder(b.folderId) === folderId)
      .map<BoardNode>((board) => ({ type: 'board', board })),
    ...dashboards
      .filter((d) => effectiveFolder(d.folderId) === folderId)
      .map<DashboardNode>((dashboard) => ({ type: 'dashboard', dashboard })),
  ];

  const build = (folderId: string | null): TreeNode[] => {
    const subFolders = folders
      .filter((f) => parentOf(f) === folderId)
      .sort(comparePositions)
      .map<FolderNode>((folder) => {
        const children = build(folder.id);
        const boardCount = children.reduce(
          (n, c) => n + (c.type === 'board' ? 1 : c.type === 'folder' ? c.boardCount : 0),
          0,
        );
        return { type: 'folder', folder, children, boardCount };
      });
    const leaves = leavesIn(folderId).sort((a, b) =>
      comparePositions(leafPosition(a), leafPosition(b)),
    );
    return [...subFolders, ...leaves];
  };

  return build(null);
}

/** One visible row of the tree, flattened for rendering and drag and drop. */
export interface TreeRow {
  /** Stable dnd/React key: `folder:<id>`, `board:<id>` or `dashboard:<id>`. */
  key: string;
  node: TreeNode;
  depth: number;
  /** Folder the row lives in (`null` = workspace root). */
  parentFolderId: string | null;
}

export const folderKey = (id: string): string => `folder:${id}`;
export const boardKey = (id: string): string => `board:${id}`;
export const dashboardKey = (id: string): string => `dashboard:${id}`;

/** The dnd/React key of any tree node. */
export function nodeKey(node: TreeNode): string {
  return node.type === 'folder'
    ? folderKey(node.folder.id)
    : node.type === 'board'
      ? boardKey(node.board.id)
      : dashboardKey(node.dashboard.id);
}

/** Flatten the tree into visible rows, skipping the children of collapsed folders. */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (list: readonly TreeNode[], depth: number, parentFolderId: string | null) => {
    for (const node of list) {
      rows.push({ key: nodeKey(node), node, depth, parentFolderId });
      if (node.type === 'folder' && expanded.has(node.folder.id)) {
        walk(node.children, depth + 1, node.folder.id);
      }
    }
  };
  walk(nodes, 0, null);
  return rows;
}

/** Keep boards and dashboards whose name matches `term` (and the folders that contain a match). */
export function filterTree(nodes: readonly TreeNode[], term: string): TreeNode[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [...nodes];
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'board' || node.type === 'dashboard') {
      const name = node.type === 'board' ? node.board.name : node.dashboard.name;
      if (name.toLowerCase().includes(needle)) out.push(node);
    } else {
      const children = filterTree(node.children, needle);
      if (children.length > 0 || node.folder.name.toLowerCase().includes(needle)) {
        out.push({ ...node, children: children.length > 0 ? children : node.children });
      }
    }
  }
  return out;
}
