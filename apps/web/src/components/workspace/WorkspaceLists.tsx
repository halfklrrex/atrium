import { Icon } from '@vibe/core';
import {
  Board,
  BoardPrivate,
  BoardShareable,
  ClassicFolder as FolderIcon,
  NavigationChevronRight,
} from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { buildTree, flattenTree, type BoardDoc, type FolderDoc, type TreeRow } from '../../data';
import { formatUpdated } from '../../lib/format';
import { BoardMenu } from '../boards/BoardMenu';
import { FavoriteStar } from '../boards/FavoriteStar';
import { UserAvatar } from '../UserAvatar';
import styles from './WorkspaceLists.module.css';

const KIND_LABEL: Record<BoardDoc['kind'], string> = {
  main: 'Board',
  private: 'Private board',
  shareable: 'Shareable board',
};

const iconFor = (kind: BoardDoc['kind']) =>
  kind === 'private' ? BoardPrivate : kind === 'shareable' ? BoardShareable : Board;

/** "Content" tab: folders and boards of the workspace; folders expand inline. */
export function WorkspaceContentList({
  folders,
  boards,
}: {
  folders: readonly FolderDoc[];
  boards: readonly BoardDoc[];
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const tree = useMemo(() => buildTree(folders, boards), [folders, boards]);
  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div role="table" aria-label="Workspace content" className={styles.table}>
      <div role="row" className={classNames(styles.grid, styles.head)}>
        <span role="columnheader">Name</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Last updated</span>
        <span role="columnheader">Created by</span>
        <span role="columnheader" className={styles.srOnly}>
          Actions
        </span>
      </div>
      {rows.map((row) => (
        <ContentRow
          key={row.key}
          row={row}
          expanded={row.node.type === 'folder' && expanded.has(row.node.folder.id)}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

function ContentRow({
  row,
  expanded,
  onToggle,
}: {
  row: TreeRow;
  expanded: boolean;
  onToggle: (folderId: string) => void;
}) {
  const style = { '--depth': row.depth } as CSSProperties;
  const { node } = row;

  if (node.type === 'folder') {
    const { folder } = node;
    return (
      <div role="row" className={classNames(styles.grid, styles.row)} style={style}>
        <span role="cell" className={styles.nameCell}>
          <button
            type="button"
            className={styles.nameButton}
            aria-expanded={expanded}
            onClick={() => onToggle(folder.id)}
          >
            <Icon
              icon={NavigationChevronRight}
              size={16}
              className={classNames(styles.chevron, expanded && styles.chevronOpen)}
            />
            <Icon icon={FolderIcon} size={20} style={{ color: folder.color }} />
            <span className={styles.name}>{folder.name}</span>
          </button>
        </span>
        <span role="cell" className={styles.muted}>
          Folder · {node.boardCount} {node.boardCount === 1 ? 'board' : 'boards'}
        </span>
        <span role="cell" className={styles.muted}>
          {formatUpdated(folder.updatedAt)}
        </span>
        <span role="cell">
          <UserAvatar uid={folder.createdBy} size="xs" />
        </span>
        <span role="cell" />
      </div>
    );
  }

  const { board } = node;
  return (
    <div role="row" className={classNames(styles.grid, styles.row)} style={style}>
      <span role="cell" className={styles.nameCell}>
        <Link to={`/boards/${board.id}`} className={styles.nameButton}>
          <span className={styles.chevronSpacer} />
          <Icon icon={iconFor(board.kind)} size={20} className={styles.boardIcon} />
          <span className={styles.name}>{board.name}</span>
        </Link>
      </span>
      <span role="cell" className={styles.muted}>
        {KIND_LABEL[board.kind]}
      </span>
      <span role="cell" className={styles.muted}>
        {formatUpdated(board.updatedAt)}
      </span>
      <span role="cell">
        <UserAvatar uid={board.createdBy} size="xs" />
      </span>
      <span role="cell" className={styles.actions}>
        <FavoriteStar board={board} size="xs" />
        <span className={styles.menu}>
          <BoardMenu board={board} size="xs" />
        </span>
      </span>
    </div>
  );
}

/** "Recents" tab: this user's recently visited boards of the workspace. */
export function WorkspaceRecentsList({ boards }: { boards: readonly BoardDoc[] }) {
  return (
    <ul className={styles.recents} aria-label="Recently visited boards">
      {boards.map((board) => (
        <li key={board.id} className={styles.recentRow}>
          <Link to={`/boards/${board.id}`} className={styles.nameButton}>
            <Icon icon={iconFor(board.kind)} size={20} className={styles.boardIcon} />
            <span className={styles.name}>{board.name}</span>
          </Link>
          <FavoriteStar board={board} size="xs" />
        </li>
      ))}
    </ul>
  );
}
