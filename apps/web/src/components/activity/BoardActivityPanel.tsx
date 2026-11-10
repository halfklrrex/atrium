import { Dropdown, IconButton } from '@vibe/core';
import { columnsForSubitems, hasLegacySubitemColumns } from '@atrium/shared';
import { CloseSmall } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DATE_PRESET_LABELS,
  MAX_ACTOR_FILTER,
  hasActivityFilters,
  sinceForPreset,
  useBoardActivity,
  type ActivityDatePreset,
  type ActivityFilters,
} from '../../data/activity';
import { useWorkspaceMembers } from '../../data/members-store';
import type { BoardDoc } from '../../data/model';
import { useUiStore } from '../AppShell/ui-store';
import { openItem } from '../board-table/open-item';
import { ActivityFeed } from './ActivityFeed';
import styles from './BoardActivityPanel.module.css';

type Option = { value: string; label: string; leftAvatar?: string };

const DATE_OPTIONS: Option[] = (['today', '7d', '30d', 'all'] as const).map((value) => ({
  value,
  label: DATE_PRESET_LABELS[value],
}));

/** Open menus and dropdown lists (closed dropdowns keep an empty listbox); Escape then belongs to them. */
const FLOATING_LAYERS = '[role="menu"], [role="listbox"]:not(:empty)';

/**
 * The board's Activity log: a right-hand side panel (opened from the board options menu) listing
 * every change on the board with filters by person, column and date.
 */
export function BoardActivityPanel({ board }: { board: BoardDoc }) {
  const open = useUiStore((s) => s.activityPanelBoardId === board.id);
  const close = useUiStore((s) => s.closeActivityPanel);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [actorIds, setActorIds] = useState<string[]>([]);
  const [columnId, setColumnId] = useState<string | null>(null);
  const [preset, setPreset] = useState<ActivityDatePreset>('all');
  const since = useMemo(() => sinceForPreset(preset), [preset]);
  const filters = useMemo<ActivityFilters>(
    () => ({ actorIds, columnId, since }),
    [actorIds, columnId, since],
  );
  // Listen only while the panel is open.
  const state = useBoardActivity(open ? board.id : undefined, filters);
  const { members } = useWorkspaceMembers(board.workspaceId);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (useUiStore.getState().dialog) return;
      // Only when focus is in the panel, so the item card keeps its own Escape.
      if (!(event.target instanceof Node && panelRef.current?.contains(event.target))) return;
      if (document.querySelector(FLOATING_LAYERS)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // Leaving the board (the header unmounts) closes its panel.
  useEffect(
    () => () => {
      if (useUiStore.getState().activityPanelBoardId === board.id) {
        useUiStore.getState().closeActivityPanel();
      }
    },
    [board.id],
  );

  const people = useMemo<Option[]>(
    () =>
      members
        .filter((m) => board.accessUids.includes(m.id) || actorIds.includes(m.id))
        .map((m) => ({
          value: m.id,
          label: m.displayName || m.email,
          ...(m.photoURL ? { leftAvatar: m.photoURL } : {}),
        })),
    [members, board.accessUids, actorIds],
  );
  const columns = useMemo<Option[]>(
    () => board.columns.map((c) => ({ value: c.id, label: c.title })),
    [board.columns],
  );
  const allColumns = useMemo(
    () => [
      ...board.columns,
      // Columns of a board not yet migrated: legacy subitem columns also label activity.
      ...(hasLegacySubitemColumns(board) ? columnsForSubitems(board) : []),
    ],
    [board],
  );

  const filtered = hasActivityFilters(filters);
  const clearFilters = () => {
    setActorIds([]);
    setColumnId(null);
    setPreset('all');
  };

  return (
    <aside
      ref={panelRef}
      id="board-activity-panel"
      data-print="hide"
      className={classNames(styles.panel, open && styles.open)}
      aria-label="Activity log"
      inert={!open}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Activity log</h2>
        <IconButton
          ref={closeRef}
          icon={CloseSmall}
          kind="tertiary"
          size="small"
          aria-label="Close activity log"
          hideTooltip
          onClick={close}
        />
      </header>

      <div className={styles.filters}>
        <div className={styles.filter}>
          <Dropdown
            size="small"
            multi
            multiline
            placeholder="Person"
            aria-label="Filter by person"
            options={people}
            value={people.filter((p) => actorIds.includes(p.value))}
            onChange={(selected: unknown) => {
              const list = (Array.isArray(selected) ? selected : []) as Option[];
              setActorIds(list.slice(0, MAX_ACTOR_FILTER).map((o) => o.value));
            }}
          />
        </div>
        <div className={styles.filter}>
          <Dropdown
            size="small"
            placeholder="Column"
            aria-label="Filter by column"
            options={columns}
            value={columns.find((c) => c.value === columnId)}
            clearable
            onChange={(selected: unknown) =>
              setColumnId((selected as Option | null)?.value ?? null)
            }
            onClear={() => setColumnId(null)}
          />
        </div>
        <div className={styles.filter}>
          <Dropdown
            size="small"
            clearable={false}
            searchable={false}
            placeholder="Date"
            aria-label="Filter by date"
            options={DATE_OPTIONS}
            value={DATE_OPTIONS.find((o) => o.value === preset)}
            onChange={(selected: unknown) =>
              setPreset(((selected as Option | null)?.value ?? 'all') as ActivityDatePreset)
            }
          />
        </div>
      </div>

      <div className={styles.body}>
        {open ? (
          <ActivityFeed
            state={state}
            columns={allColumns}
            showItem
            onOpenItem={(itemId) => openItem(board.id, itemId)}
            filtered={filtered}
            onClearFilters={clearFilters}
            emptyBody="Changes to this board will show up here as they happen."
            label="Board activity"
          />
        ) : null}
      </div>
    </aside>
  );
}
