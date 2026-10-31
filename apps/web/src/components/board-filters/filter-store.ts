import { useMemo } from 'react';
import { create } from 'zustand';
import {
  MAIN_VIEW_ID,
  createDefaultFilterState,
  defaultCalendarSettings,
  defaultKanbanSettings,
  defaultTimelineViewSettings,
  defaultViewSettings,
  type BoardFilterState,
  type ColumnDef,
  type CalendarSettings,
  type KanbanSettings,
  type TimelineViewSettings,
  type FilterCondition,
  type FilterGroup,
  type SortCondition,
  type ViewSettings,
} from '@atrium/shared';

/**
 * Columns the sort, filter and group-by menus offer. A Mirror column is computed in its cell and
 * stored nowhere, so the table cannot order or filter by it (v1).
 */
export const isOrderable = (column: ColumnDef): boolean => column.type !== 'mirror';

/** The per-type settings a view can carry, by view type (a table has none). */
export interface TypeSettingsMap {
  kanban: KanbanSettings;
  calendar: CalendarSettings;
  timeline: TimelineViewSettings;
}
export type SettingsViewType = keyof TypeSettingsMap;

const TYPE_KEYS: readonly SettingsViewType[] = ['kanban', 'calendar', 'timeline'];
const TYPE_DEFAULTS: { [K in SettingsViewType]: () => TypeSettingsMap[K] } = {
  kanban: defaultKanbanSettings,
  calendar: defaultCalendarSettings,
  timeline: defaultTimelineViewSettings,
};

/** What a view remembers and what the toolbar can change without saving: filters plus Hide. */
export interface ViewState {
  filter: BoardFilterState;
  hiddenColumnIds: string[];
  /** Kanban lane and card settings; `null` for a view that has none (a table, or nothing saved yet). */
  kanban: KanbanSettings | null;
  /** Calendar settings; `null` for a view that has none. */
  calendar: CalendarSettings | null;
  /** Timeline settings; `null` for a view that has none. */
  timeline: TimelineViewSettings | null;
}

/** `saved` mirrors the stored view; `current` is what the user sees (and may have changed). */
interface ViewEntry {
  saved: ViewState;
  current: ViewState;
}

/** Store key of one view of one board. */
export const viewKey = (boardId: string, viewId: string): string => `${boardId}:${viewId}`;

export function stateFromSettings(settings: ViewSettings | null | undefined): ViewState {
  const s = settings ?? defaultViewSettings();
  return {
    filter: {
      ...createDefaultFilterState(),
      personIds: [...s.filter.personIds],
      filterGroup: {
        conjunction: s.filter.filterGroup.conjunction,
        conditions: s.filter.filterGroup.conditions.map((c) => ({ ...c })),
      },
      sortConditions: s.filter.sortConditions.map((c) => ({ ...c })),
      groupByColumnId: s.filter.groupByColumnId,
    },
    hiddenColumnIds: [...s.hiddenColumnIds],
    kanban: s.kanban ? structuredClone(s.kanban) : null,
    calendar: s.calendar ? structuredClone(s.calendar) : null,
    timeline: s.timeline ? structuredClone(s.timeline) : null,
  };
}

/** The part of a view state that is saved (search text is per session and never saved). */
export function settingsFromState(state: ViewState, base?: ViewSettings): ViewSettings {
  const { kanban: _k, calendar: _c, timeline: _t, ...rest } = base ?? defaultViewSettings();
  return {
    ...rest,
    ...(state.kanban ? { kanban: state.kanban } : {}),
    ...(state.calendar ? { calendar: state.calendar } : {}),
    ...(state.timeline ? { timeline: state.timeline } : {}),
    filter: {
      personIds: state.filter.personIds,
      filterGroup: state.filter.filterGroup,
      sortConditions: state.filter.sortConditions,
      groupByColumnId: state.filter.groupByColumnId,
    },
    hiddenColumnIds: state.hiddenColumnIds,
  };
}

const fingerprint = (state: ViewState): string =>
  JSON.stringify([
    state.filter.personIds,
    state.filter.filterGroup,
    state.filter.sortConditions,
    state.filter.groupByColumnId,
    state.hiddenColumnIds,
    ...TYPE_KEYS.map((key) => state[key]),
  ]);

export function isViewDirty(entry: ViewEntry | undefined): boolean {
  return entry ? fingerprint(entry.saved) !== fingerprint(entry.current) : false;
}

const emptyState = (): ViewState => ({
  filter: createDefaultFilterState(),
  hiddenColumnIds: [],
  kanban: null,
  calendar: null,
  timeline: null,
});

interface FilterStoreState {
  /** The view each board currently shows; actions below act on it. */
  activeView: Record<string, string>;
  views: Record<string, ViewEntry>;

  /**
   * Show a view and sync it with its stored settings (`null` = nothing stored yet). Unsaved changes
   * survive a re-sync; an untouched view follows the stored settings.
   */
  syncView: (boardId: string, viewId: string, settings: ViewSettings | null) => void;
  /** After a save: what is on screen is now what is stored. */
  markSaved: (boardId: string) => void;
  /** Throw away unsaved changes. */
  discardChanges: (boardId: string) => void;

  getFilterState: (boardId: string) => BoardFilterState;
  setSearchQuery: (boardId: string, searchQuery: string) => void;
  togglePersonFilter: (boardId: string, personId: string) => void;
  setPersonIds: (boardId: string, personIds: string[]) => void;
  addCondition: (boardId: string, condition: FilterCondition) => void;
  updateCondition: (boardId: string, index: number, condition: Partial<FilterCondition>) => void;
  removeCondition: (boardId: string, index: number) => void;
  setConjunction: (boardId: string, conjunction: 'and' | 'or') => void;
  setFilterGroup: (boardId: string, filterGroup: FilterGroup) => void;
  setSortConditions: (boardId: string, sortConditions: SortCondition[]) => void;
  toggleSort: (boardId: string, columnId: string) => void;
  setGroupBy: (boardId: string, groupByColumnId: string | null) => void;
  resetFilters: (boardId: string) => void;
  setHiddenColumnIds: (boardId: string, ids: string[]) => void;
  /** Change one view type's settings (counts as an unsaved change). */
  setTypeSettings: <T extends SettingsViewType>(
    boardId: string,
    type: T,
    patch: Partial<TypeSettingsMap[T]>,
  ) => void;
  /** Change Kanban lane and card settings (counts as an unsaved change). */
  setKanban: (boardId: string, patch: Partial<KanbanSettings>) => void;
  /** Collapse or expand one Kanban lane. */
  toggleLane: (boardId: string, laneKey: string) => void;
}

export const useFilterStore = create<FilterStoreState>()((set, get) => {
  /** Change the current state of the board's active view. */
  const change = (boardId: string, fn: (current: ViewState) => ViewState) =>
    set((state) => {
      const key = viewKey(boardId, state.activeView[boardId] ?? MAIN_VIEW_ID);
      const entry = state.views[key] ?? { saved: emptyState(), current: emptyState() };
      return { views: { ...state.views, [key]: { ...entry, current: fn(entry.current) } } };
    });
  const changeFilter = (boardId: string, fn: (filter: BoardFilterState) => BoardFilterState) =>
    change(boardId, (current) => ({ ...current, filter: fn(current.filter) }));

  return {
    activeView: {},
    views: {},

    syncView: (boardId, viewId, settings) =>
      set((state) => {
        const key = viewKey(boardId, viewId);
        const saved = stateFromSettings(settings);
        const existing = state.views[key];
        const entry: ViewEntry = !existing
          ? { saved, current: structuredClone(saved) }
          : isViewDirty(existing)
            ? { saved, current: existing.current }
            : {
                saved,
                // Keep the session's search text when a stored view re-syncs.
                current: {
                  ...structuredClone(saved),
                  filter: {
                    ...structuredClone(saved).filter,
                    searchQuery: existing.current.filter.searchQuery,
                  },
                },
              };
        return {
          activeView: { ...state.activeView, [boardId]: viewId },
          views: { ...state.views, [key]: entry },
        };
      }),

    markSaved: (boardId) =>
      set((state) => {
        const key = viewKey(boardId, state.activeView[boardId] ?? MAIN_VIEW_ID);
        const entry = state.views[key];
        if (!entry) return state;
        return {
          views: { ...state.views, [key]: { ...entry, saved: structuredClone(entry.current) } },
        };
      }),

    discardChanges: (boardId) =>
      set((state) => {
        const key = viewKey(boardId, state.activeView[boardId] ?? MAIN_VIEW_ID);
        const entry = state.views[key];
        if (!entry) return state;
        const searchQuery = entry.current.filter.searchQuery;
        const saved = structuredClone(entry.saved);
        return {
          views: {
            ...state.views,
            [key]: {
              saved: entry.saved,
              current: { ...saved, filter: { ...saved.filter, searchQuery } },
            },
          },
        };
      }),

    getFilterState: (boardId) => {
      const { activeView, views } = get();
      return (
        views[viewKey(boardId, activeView[boardId] ?? MAIN_VIEW_ID)]?.current.filter ??
        createDefaultFilterState()
      );
    },

    setSearchQuery: (boardId, searchQuery) =>
      changeFilter(boardId, (filter) => ({ ...filter, searchQuery })),

    togglePersonFilter: (boardId, personId) =>
      changeFilter(boardId, (filter) => ({
        ...filter,
        personIds: filter.personIds.includes(personId)
          ? filter.personIds.filter((id) => id !== personId)
          : [...filter.personIds, personId],
      })),

    setPersonIds: (boardId, personIds) =>
      changeFilter(boardId, (filter) => ({ ...filter, personIds })),

    addCondition: (boardId, condition) =>
      changeFilter(boardId, (filter) => ({
        ...filter,
        filterGroup: {
          ...filter.filterGroup,
          conditions: [...filter.filterGroup.conditions, condition],
        },
      })),

    updateCondition: (boardId, index, patch) =>
      changeFilter(boardId, (filter) => ({
        ...filter,
        filterGroup: {
          ...filter.filterGroup,
          conditions: filter.filterGroup.conditions.map((c, i) =>
            i === index ? { ...c, ...patch } : c,
          ),
        },
      })),

    removeCondition: (boardId, index) =>
      changeFilter(boardId, (filter) => ({
        ...filter,
        filterGroup: {
          ...filter.filterGroup,
          conditions: filter.filterGroup.conditions.filter((_, i) => i !== index),
        },
      })),

    setConjunction: (boardId, conjunction) =>
      changeFilter(boardId, (filter) => ({
        ...filter,
        filterGroup: { ...filter.filterGroup, conjunction },
      })),

    setFilterGroup: (boardId, filterGroup) =>
      changeFilter(boardId, (filter) => ({ ...filter, filterGroup })),

    setSortConditions: (boardId, sortConditions) =>
      changeFilter(boardId, (filter) => ({ ...filter, sortConditions })),

    toggleSort: (boardId, columnId) =>
      changeFilter(boardId, (filter) => {
        const existing = filter.sortConditions.find((s) => s.columnId === columnId);
        let sortConditions: SortCondition[];
        if (!existing) {
          sortConditions = [...filter.sortConditions, { columnId, direction: 'asc' }];
        } else if (existing.direction === 'asc') {
          sortConditions = filter.sortConditions.map((s) =>
            s.columnId === columnId ? { ...s, direction: 'desc' as const } : s,
          );
        } else {
          sortConditions = filter.sortConditions.filter((s) => s.columnId !== columnId);
        }
        return { ...filter, sortConditions };
      }),

    setGroupBy: (boardId, groupByColumnId) =>
      changeFilter(boardId, (filter) => ({ ...filter, groupByColumnId })),

    /** Clear every filter, sort and group-by of the view; hidden columns stay. */
    resetFilters: (boardId) =>
      change(boardId, (current) => ({ ...current, filter: createDefaultFilterState() })),

    setHiddenColumnIds: (boardId, hiddenColumnIds) =>
      change(boardId, (current) => ({ ...current, hiddenColumnIds })),

    setTypeSettings: (boardId, type, patch) =>
      change(boardId, (current) => ({
        ...current,
        [type]: { ...(current[type] ?? TYPE_DEFAULTS[type]()), ...patch },
      })),

    setKanban: (boardId, patch) => get().setTypeSettings(boardId, 'kanban', patch),

    toggleLane: (boardId, laneKey) =>
      change(boardId, (current) => {
        const kanban = current.kanban ?? defaultKanbanSettings();
        const collapsed = kanban.collapsedLaneIds.includes(laneKey)
          ? kanban.collapsedLaneIds.filter((k) => k !== laneKey)
          : [...kanban.collapsedLaneIds, laneKey];
        return { ...current, kanban: { ...kanban, collapsedLaneIds: collapsed } };
      }),
  };
});

const DEFAULT_FILTER_STATE: BoardFilterState = createDefaultFilterState();
const NO_HIDDEN: string[] = [];

/** What the board's active view shows right now (unsaved changes included). */
export function currentViewState(boardId: string): ViewState {
  const s = useFilterStore.getState();
  return entryOf(s, boardId)?.current ?? emptyState();
}

/** The id of the view the board is showing. */
export function useActiveViewId(boardId: string | undefined): string {
  return useFilterStore((s) => s.activeView[boardId ?? '__default__'] ?? MAIN_VIEW_ID);
}

const entryOf = (
  s: Pick<FilterStoreState, 'activeView' | 'views'>,
  boardId: string,
): ViewEntry | undefined => s.views[viewKey(boardId, s.activeView[boardId] ?? MAIN_VIEW_ID)];

/** Whether the board's active view has unsaved filter, sort, group-by or Hide changes. */
export function useViewDirty(boardId: string | undefined): boolean {
  return useFilterStore((s) => isViewDirty(entryOf(s, boardId ?? '__default__')));
}

/** Whether the given view of a board has unsaved changes (for the tab dot). */
export function useViewIdDirty(boardId: string, viewId: string): boolean {
  return useFilterStore((s) => isViewDirty(s.views[viewKey(boardId, viewId)]));
}

/** The active view's settings of one type (unsaved changes included; defaults when none are stored). */
export function useViewTypeSettings<T extends SettingsViewType>(
  boardId: string | undefined,
  type: T,
): TypeSettingsMap[T] {
  const stored = useFilterStore((s) => entryOf(s, boardId ?? '__default__')?.current[type]) as
    TypeSettingsMap[T] | null | undefined;
  return useMemo(() => stored ?? TYPE_DEFAULTS[type](), [stored, type]);
}

/** The active Kanban view's settings (unsaved changes included; defaults when none are stored). */
export function useKanbanSettings(boardId: string | undefined): KanbanSettings {
  return useViewTypeSettings(boardId, 'kanban');
}

/** Column ids the active view hides (unsaved Hide changes included). */
export function useHiddenColumnIds(boardId: string | undefined): string[] {
  return useFilterStore(
    (s) => entryOf(s, boardId ?? '__default__')?.current.hiddenColumnIds ?? NO_HIDDEN,
  );
}

export function useBoardFilter(boardId: string | undefined) {
  const currentBoardId = boardId ?? '__default__';
  const filterState = useFilterStore(
    (s) => entryOf(s, currentBoardId)?.current.filter ?? DEFAULT_FILTER_STATE,
  );

  const activeFilterCount =
    (filterState.searchQuery?.trim() ? 1 : 0) +
    filterState.personIds.length +
    filterState.filterGroup.conditions.length;

  const isSorted = filterState.sortConditions.length > 0;
  const isGrouped = filterState.groupByColumnId !== null;

  return {
    filterState,
    activeFilterCount,
    isSorted,
    isGrouped,
    setSearchQuery: (q: string) => useFilterStore.getState().setSearchQuery(currentBoardId, q),
    togglePersonFilter: (pid: string) =>
      useFilterStore.getState().togglePersonFilter(currentBoardId, pid),
    setPersonIds: (pids: string[]) => useFilterStore.getState().setPersonIds(currentBoardId, pids),
    addCondition: (cond: FilterCondition) =>
      useFilterStore.getState().addCondition(currentBoardId, cond),
    updateCondition: (index: number, cond: Partial<FilterCondition>) =>
      useFilterStore.getState().updateCondition(currentBoardId, index, cond),
    removeCondition: (index: number) =>
      useFilterStore.getState().removeCondition(currentBoardId, index),
    setConjunction: (conj: 'and' | 'or') =>
      useFilterStore.getState().setConjunction(currentBoardId, conj),
    setSortConditions: (sorts: SortCondition[]) =>
      useFilterStore.getState().setSortConditions(currentBoardId, sorts),
    toggleSort: (colId: string) => useFilterStore.getState().toggleSort(currentBoardId, colId),
    setGroupBy: (colId: string | null) =>
      useFilterStore.getState().setGroupBy(currentBoardId, colId),
    resetFilters: () => useFilterStore.getState().resetFilters(currentBoardId),
  };
}
