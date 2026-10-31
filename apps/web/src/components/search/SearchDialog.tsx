import {
  Button,
  Icon,
  Loader,
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalHeader,
  Search,
  Tab,
  TabList,
} from '@vibe/core';
import { Board, BoardPrivate, BoardShareable, Subitems, Workspace } from '@vibe/icons';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useRecents, useWorkspaces } from '../../data/hooks';
import type { BoardDoc, ItemDoc } from '../../data/model';
import { useReadableBoards } from '../../data/my-work';
import { searchItems } from '../../data/search';
import { EmptyState } from '../EmptyState/EmptyState';
import { NoSearchResults } from '../illustrations';
import {
  MIN_ITEM_CHARS,
  capGroups,
  filterByName,
  flattenGroups,
  groupsForTab,
  highlightParts,
  moveActive,
  rankByPrefix,
  resultPath,
  termWords,
  type SearchGroups,
  type SearchResult,
  type SearchTab,
} from './search-model';
import styles from './SearchDialog.module.css';

/** Items are searched this long after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 300;
const MAX_RECENT_BOARDS = 8;
const TABS: SearchTab[] = ['all', 'boards', 'items'];
const TAB_LABELS: Record<SearchTab, string> = { all: 'All', boards: 'Boards', items: 'Items' };

function Marked({ text, term }: { text: string; term: string }) {
  return (
    <>
      {highlightParts(text, term).map((part, i) =>
        part.match ? (
          <mark key={i} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function describe(result: SearchResult): { icon: typeof Workspace; name: string; crumb: string } {
  if (result.kind === 'board') {
    return { icon: boardIcon(result.board), name: result.board.name, crumb: result.workspaceName };
  }
  if (result.kind === 'workspace')
    return { icon: Workspace, name: result.workspace.name, crumb: '' };
  const { item, board, groupTitle } = result;
  return {
    icon: item.parentItemId != null ? Subitems : boardIcon(board),
    name: item.name,
    crumb: groupTitle ? `${board.name} › ${groupTitle}` : board.name,
  };
}

function boardIcon(board: BoardDoc) {
  return board.kind === 'private'
    ? BoardPrivate
    : board.kind === 'shareable'
      ? BoardShareable
      : Board;
}

interface ItemHits {
  /** The run these hits answer: the debounced term and the retry count. */
  runKey: string;
  entries: { item: ItemDoc; board: BoardDoc }[];
  running: boolean;
  total: number;
  error: boolean;
}

const NO_HITS: ItemHits = { runKey: '', entries: [], running: false, total: 0, error: false };

/** "Search everything": workspaces and boards filter instantly, items are looked up per board. */
export function SearchDialog({
  initialTerm = '',
  onClose,
}: {
  initialTerm?: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const navigate = useNavigate();
  const listId = useId();
  const workspaces = useWorkspaces(uid);
  const boards = useReadableBoards(uid);
  const recents = useRecents(uid);
  const [term, setTerm] = useState(initialTerm);
  const [debounced, setDebounced] = useState(initialTerm.trim());
  const [tab, setTab] = useState<SearchTab>('all');
  const [activeState, setActiveState] = useState<{ key: string; index: number } | null>(null);
  const [hits, setHits] = useState<ItemHits>(NO_HITS);
  const [attempt, setAttempt] = useState(0);
  const inputWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const boardsKey = boards.data.map((b) => b.id).join('|');
  const boardsRef = useRef(boards.data);
  useEffect(() => {
    boardsRef.current = boards.data;
  }, [boards.data]);
  const first = termWords(debounced)[0];
  const itemsWanted = !!first && [...first].length >= MIN_ITEM_CHARS && !boards.loading;

  const runKey = `${attempt}:${debounced}`;
  useEffect(() => {
    if (!itemsWanted) return;
    const controller = new AbortController();
    const targets = boardsRef.current;
    const begin = (h: ItemHits): ItemHits =>
      h.runKey === runKey
        ? h
        : { runKey, entries: [], running: true, total: targets.length, error: false };
    void searchItems(targets, debounced, controller.signal, (board, items) => {
      setHits((h) => {
        const current = begin(h);
        return {
          ...current,
          entries: [...current.entries, ...items.map((item) => ({ item, board }))],
        };
      });
    }).then((outcome) => {
      if (controller.signal.aborted) return;
      setHits((h) => ({
        ...begin(h),
        running: false,
        total: outcome.total,
        error: outcome.total > 0 && outcome.failed === outcome.total,
      }));
    });
    return () => controller.abort();
  }, [itemsWanted, debounced, runKey, boardsKey]);

  const trimmed = term.trim();
  const workspaceName = useMemo(
    () => new Map(workspaces.data.map((w) => [w.id, w.name])),
    [workspaces.data],
  );

  const groups = useMemo<SearchGroups>(() => {
    const boardResult = (board: BoardDoc) => ({
      kind: 'board' as const,
      id: `board:${board.id}`,
      board,
      workspaceName: workspaceName.get(board.workspaceId) ?? '',
    });
    if (!trimmed) {
      const byId = new Map(boards.data.map((b) => [b.id, b]));
      const recentBoards = recents.data
        .map((r) => byId.get(r.boardId))
        .filter((b): b is BoardDoc => !!b)
        .slice(0, MAX_RECENT_BOARDS);
      return { workspaces: [], boards: recentBoards.map(boardResult), items: [] };
    }
    const itemRows = hits.runKey === runKey && itemsWanted ? hits.entries : [];
    return capGroups({
      workspaces: filterByName(workspaces.data, (w) => w.name, trimmed).map((workspace) => ({
        kind: 'workspace' as const,
        id: `workspace:${workspace.id}`,
        workspace,
      })),
      boards: filterByName(boards.data, (b) => b.name, trimmed).map(boardResult),
      items: rankByPrefix(itemRows, (e) => e.item.name, trimmed).map(({ item, board }) => ({
        kind: 'item' as const,
        id: `item:${board.id}:${item.id}`,
        item,
        board,
        groupTitle: board.groups.find((g) => g.id === item.groupId)?.title ?? '',
      })),
    });
  }, [
    trimmed,
    workspaces.data,
    boards.data,
    recents.data,
    workspaceName,
    hits,
    runKey,
    itemsWanted,
  ]);

  const visible = useMemo(() => groupsForTab(groups, tab), [groups, tab]);
  const flat = useMemo(() => flattenGroups(visible), [visible]);
  // The first row is active as soon as there is something to open; arrows and hover move it.
  const activeKey = `${trimmed}|${tab}|${flat.length}`;
  const active = activeState?.key === activeKey ? activeState.index : flat.length > 0 ? 0 : -1;
  const setActive = (index: number) => setActiveState({ key: activeKey, index });
  const activeResult = flat[active];
  const activeId = activeResult ? `${listId}-${activeResult.id}` : undefined;

  // Vibe's Search owns its input; the combobox wiring is applied to it directly.
  useEffect(() => {
    const input = inputWrap.current?.querySelector('input');
    if (!input) return;
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-autocomplete', 'list');
    if (activeId) input.setAttribute('aria-activedescendant', activeId);
    else input.removeAttribute('aria-activedescendant');
  }, [activeId, listId]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const open = (result: SearchResult) => {
    onClose();
    void navigate(resultPath(result));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(moveActive(active, event.key === 'ArrowDown' ? 1 : -1, flat.length));
    } else if (event.key === 'Enter' && activeResult) {
      event.preventDefault();
      open(activeResult);
    }
  };

  const total = hits.runKey === runKey ? hits.total : boards.data.length;
  const showItems = tab !== 'boards';
  const itemsRelevant = trimmed !== '' && showItems && itemsWanted;
  const searchingItems = itemsRelevant && (hits.running || hits.runKey !== runKey);
  const itemsFailed = itemsRelevant && hits.runKey === runKey && hits.error;
  const typedTooShort = trimmed !== '' && showItems && !itemsWanted && !boards.loading;
  const waitingForDebounce = trimmed !== '' && trimmed !== debounced;
  const noResults =
    trimmed !== '' && flat.length === 0 && !searchingItems && !itemsFailed && !waitingForDebounce;

  const renderRow = (result: SearchResult) => {
    const index = flat.indexOf(result);
    const isActive = index === active;
    const { icon, name, crumb } = describe(result);
    return (
      <div
        key={result.id}
        id={`${listId}-${result.id}`}
        role="option"
        aria-selected={isActive}
        className={isActive ? `${styles.row} ${styles.active}` : styles.row}
        onMouseMove={() => setActive(index)}
        onClick={() => open(result)}
      >
        <Icon icon={icon} size={16} className={styles.icon} />
        <span className={styles.text}>
          <span className={styles.name}>
            <Marked text={name} term={trimmed} />
          </span>
          {crumb ? <span className={styles.crumb}>{crumb}</span> : null}
        </span>
      </div>
    );
  };

  const section = (label: string, rows: SearchResult[]) =>
    rows.length === 0 ? null : (
      <div role="group" aria-label={label} key={label}>
        <div className={styles.groupLabel} aria-hidden="true">
          {label}
        </div>
        {rows.map(renderRow)}
      </div>
    );

  return (
    <Modal id="search-dialog" show size="medium" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Search everything" />
        <ModalContent>
          <div className={styles.body} onKeyDown={onKeyDown}>
            <div ref={inputWrap}>
              <Search
                value={term}
                onChange={setTerm}
                placeholder="Search boards, items and workspaces"
                inputAriaLabel="Search everything"
                autoFocus
                debounceRate={0}
              />
            </div>
            <TabList
              activeTabId={TABS.indexOf(tab)}
              onTabChange={(i) => setTab(TABS[i] ?? 'all')}
              size="sm"
            >
              {TABS.map((id) => (
                <Tab key={id}>{TAB_LABELS[id]}</Tab>
              ))}
            </TabList>

            <div role="listbox" id={listId} aria-label="Search results" className={styles.list}>
              {!trimmed && flat.length > 0 ? (
                <div className={styles.groupLabel} aria-hidden="true">
                  Recent boards
                </div>
              ) : null}
              {section('Workspaces', visible.workspaces)}
              {section('Boards', visible.boards)}
              {section('Items', visible.items)}
            </div>

            {searchingItems ? (
              <div className={styles.status} role="status">
                <Loader size="xs" />
                <span>
                  Searching {total} {total === 1 ? 'board' : 'boards'}
                </span>
              </div>
            ) : null}
            {typedTooShort ? (
              <div className={styles.status}>Type at least 2 characters to search items</div>
            ) : null}
            {itemsFailed ? (
              <div className={styles.status} role="alert">
                <span>Couldn’t search items</span>
                <Button kind="tertiary" size="small" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </Button>
              </div>
            ) : null}
            {noResults ? (
              <div className={styles.empty}>
                <EmptyState
                  size="inline"
                  illustration={<NoSearchResults width={160} />}
                  title={`No results for “${trimmed}”`}
                />
              </div>
            ) : null}
            {!trimmed && flat.length === 0 && !boards.loading && !recents.loading ? (
              <div className={styles.status}>
                Start typing to search your boards, items and workspaces
              </div>
            ) : null}
          </div>
        </ModalContent>
      </ModalBasicLayout>
    </Modal>
  );
}
