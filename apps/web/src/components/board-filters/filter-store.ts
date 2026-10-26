import { create } from 'zustand';
import {
  createDefaultFilterState,
  type BoardFilterState,
  type FilterCondition,
  type FilterGroup,
  type SortCondition,
} from '@atrium/shared';

interface FilterStoreState {
  boardFilters: Record<string, BoardFilterState>;
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
}

export const useFilterStore = create<FilterStoreState>()((set, get) => ({
  boardFilters: {},

  getFilterState: (boardId: string) => get().boardFilters[boardId] ?? createDefaultFilterState(),

  setSearchQuery: (boardId: string, searchQuery: string) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: { ...current, searchQuery },
        },
      };
    }),

  togglePersonFilter: (boardId: string, personId: string) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      const exists = current.personIds.includes(personId);
      const nextPersonIds = exists
        ? current.personIds.filter((id) => id !== personId)
        : [...current.personIds, personId];
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: { ...current, personIds: nextPersonIds },
        },
      };
    }),

  setPersonIds: (boardId: string, personIds: string[]) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: { ...current, personIds },
        },
      };
    }),

  addCondition: (boardId: string, condition: FilterCondition) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: {
            ...current,
            filterGroup: {
              ...current.filterGroup,
              conditions: [...current.filterGroup.conditions, condition],
            },
          },
        },
      };
    }),

  updateCondition: (boardId: string, index: number, patch: Partial<FilterCondition>) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      const conditions = current.filterGroup.conditions.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      );
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: {
            ...current,
            filterGroup: {
              ...current.filterGroup,
              conditions,
            },
          },
        },
      };
    }),

  removeCondition: (boardId: string, index: number) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      const conditions = current.filterGroup.conditions.filter((_, i) => i !== index);
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: {
            ...current,
            filterGroup: {
              ...current.filterGroup,
              conditions,
            },
          },
        },
      };
    }),

  setConjunction: (boardId: string, conjunction: 'and' | 'or') =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: {
            ...current,
            filterGroup: {
              ...current.filterGroup,
              conjunction,
            },
          },
        },
      };
    }),

  setFilterGroup: (boardId: string, filterGroup: FilterGroup) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: { ...current, filterGroup },
        },
      };
    }),

  setSortConditions: (boardId: string, sortConditions: SortCondition[]) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: { ...current, sortConditions },
        },
      };
    }),

  toggleSort: (boardId: string, columnId: string) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      const existing = current.sortConditions.find((s) => s.columnId === columnId);
      let nextSorts: SortCondition[];

      if (!existing) {
        nextSorts = [...current.sortConditions, { columnId, direction: 'asc' }];
      } else if (existing.direction === 'asc') {
        nextSorts = current.sortConditions.map((s) =>
          s.columnId === columnId ? { ...s, direction: 'desc' as const } : s,
        );
      } else {
        nextSorts = current.sortConditions.filter((s) => s.columnId !== columnId);
      }

      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: { ...current, sortConditions: nextSorts },
        },
      };
    }),

  setGroupBy: (boardId: string, groupByColumnId: string | null) =>
    set((state) => {
      const current = state.boardFilters[boardId] ?? createDefaultFilterState();
      return {
        boardFilters: {
          ...state.boardFilters,
          [boardId]: { ...current, groupByColumnId },
        },
      };
    }),

  resetFilters: (boardId: string) =>
    set((state) => ({
      boardFilters: {
        ...state.boardFilters,
        [boardId]: createDefaultFilterState(),
      },
    })),
}));

const DEFAULT_FILTER_STATE: BoardFilterState = createDefaultFilterState();

export function useBoardFilter(boardId: string | undefined) {
  const currentBoardId = boardId ?? '__default__';
  const filterState = useFilterStore((s) => s.boardFilters[currentBoardId] ?? DEFAULT_FILTER_STATE);

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
