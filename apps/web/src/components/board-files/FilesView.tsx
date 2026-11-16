import { Button, Loader } from '@vibe/core';
import { Retry } from '@vibe/icons';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useItems, useUserLookup, type BoardDoc } from '../../data';
import { useBoardFilter, useViewTypeSettings } from '../board-filters';
import { selectItems } from '../board-date-views/date-view-model';
import { BoardToolbar } from '../board-table/BoardToolbar';
import { openItem } from '../board-table/open-item';
import { buildColumnViews } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { useDeepStable } from '../board-table/useDeepStable';
import { EmptyState } from '../EmptyState/EmptyState';
import { FileCard } from './FileCard';
import { FilesViewControls } from './FilesViewControls';
import { useBoardUpdateFiles } from './useBoardUpdateFiles';
import { collectFiles } from './files-view-model';
import styles from './files-view.module.css';

/** Cards drawn first, and added by each "Show more". */
export const FILES_PAGE_SIZE = 120;

export interface FilesViewProps {
  board: BoardDoc;
}

/** The Files view: a grid of the files in the board's Files columns. */
export function FilesView({ board }: FilesViewProps) {
  const { data: items, loading, error } = useItems(board.id);
  const memberLookup = useUserLookup(board.workspaceId);
  const boardId = board.id;
  // How many cards are drawn; a new search or filter (a new `pageKey`) starts from the first page.
  const [paging, setPaging] = useState({ key: '', shown: FILES_PAGE_SIZE });

  const userName = useMemo(
    () => (targetUid: string) => memberLookup(targetUid)?.name,
    [memberLookup],
  );

  // Search is per session: a fresh board starts without it.
  useEffect(() => {
    useTableStore.getState().reset(boardId);
  }, [boardId]);

  const columnDefs = useDeepStable(board.columns);
  const columns = useMemo(() => buildColumnViews(columnDefs), [columnDefs]);
  const fileColumns = useMemo(
    () =>
      columns
        .filter((c) => c.def.type === 'files')
        .map((c) => ({ id: c.def.id, title: c.def.title })),
    [columns],
  );
  const settings = useViewTypeSettings(boardId, 'files');
  const { filterState } = useBoardFilter(boardId);
  const search = useDeferredValue(useTableStore((s) => s.search)).trim();
  const updates = useBoardUpdateFiles(boardId, settings.includeUpdates);

  // The search is applied per file (item name or file name), so the item step gets none.
  const filteredItems = useMemo(
    () => selectItems({ items, columns, filterState, search: '' }),
    [items, columns, filterState],
  );
  const cards = useMemo(
    () =>
      collectFiles({
        items: filteredItems,
        columns: fileColumns,
        settings,
        search,
        updateFiles: updates.files,
      }),
    [filteredItems, fileColumns, settings, search, updates.files],
  );
  const anyFiles = useMemo(
    () =>
      collectFiles({
        items: selectItems({ items, columns, filterState: undefined, search: '' }),
        columns: fileColumns,
        settings: { ...settings, columnIds: null, kinds: [] },
        search: '',
        updateFiles: updates.files,
      }).length > 0,
    [items, columns, fileColumns, settings, updates.files],
  );

  const pageKey = `${search}|${JSON.stringify([filterState, settings])}|${cards.length}`;
  const shown = paging.key === pageKey ? paging.shown : FILES_PAGE_SIZE;

  const count = cards.length === 1 ? '1 file' : `${cards.length} files`;
  const trailing = (
    <>
      {fileColumns.length > 0 || settings.includeUpdates ? (
        <FilesViewControls boardId={boardId} settings={settings} fileColumns={fileColumns} />
      ) : null}
      <span className={styles.count} aria-live="polite">
        {loading || error || !anyFiles ? '' : count}
      </span>
      {settings.includeUpdates ? (
        <Button
          kind="tertiary"
          size="small"
          leftIcon={Retry}
          disabled={updates.loading}
          onClick={updates.refresh}
          aria-label="Refresh files"
        >
          Refresh
        </Button>
      ) : null}
    </>
  );

  let body;
  if (loading || (updates.loading && !anyFiles)) {
    body = (
      <div className={styles.state} role="status">
        <Loader size="medium" />
      </div>
    );
  } else if (error) {
    body = (
      <p className={styles.state} role="alert">
        Could not load the items. Check your connection and try again.
      </p>
    );
  } else if (fileColumns.length === 0 && !anyFiles) {
    body = (
      <EmptyState
        size="page"
        title="No Files column yet"
        body="Add a Files column to collect files here, then they show up in this view."
      />
    );
  } else if (!anyFiles) {
    body = (
      <EmptyState
        size="page"
        title="No files yet"
        body="Files added to this board's Files columns or updates show up here."
      />
    );
  } else if (cards.length === 0) {
    body = (
      <EmptyState
        size="page"
        title="No files match"
        body="Try other filters or clear the search."
      />
    );
  } else {
    body = (
      <>
        <ul className={styles.grid} aria-label="Files">
          {cards.slice(0, shown).map((card) => (
            <FileCard
              key={card.key}
              boardId={boardId}
              card={card}
              userName={userName}
              onOpenItem={(itemId) => openItem(boardId, itemId, { tab: 'files' })}
            />
          ))}
        </ul>
        {cards.length > shown ? (
          <div className={styles.more}>
            <Button
              kind="secondary"
              size="small"
              onClick={() => setPaging({ key: pageKey, shown: shown + FILES_PAGE_SIZE })}
            >
              Show more
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.root}>
      <BoardToolbar
        board={board}
        items={items}
        userLookup={userName}
        variant="files"
        trailing={trailing}
      />
      <div className={styles.scroll}>
        {updates.error ? (
          <p className={styles.note} role="alert">
            Could not load update files. Press Refresh to try again.
          </p>
        ) : null}
        {updates.truncated ? (
          <p className={styles.note} role="status">
            Some update files aren&apos;t shown.
          </p>
        ) : null}
        {body}
      </div>
    </div>
  );
}
