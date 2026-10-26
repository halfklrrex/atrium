import type { GroupDef } from '@atrium/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SortState } from './table-model';

export interface CellRef {
  itemId: string;
  columnId: string;
}

export interface DropMarker {
  groupId: string;
  /** The row the marker hangs on; `null` marks the end of the group. */
  itemId: string | null;
  edge: 'before' | 'after';
}

/** Transient UI state of the open board table: selection, the active cell, search. */
interface TableState {
  /** Board this state belongs to; switching boards resets everything. */
  boardId: string | null;
  selected: ReadonlySet<string>;
  active: CellRef | null;
  /** The one cell whose editor is open. */
  editing: CellRef | null;
  /** Item whose name is being edited inline (a freshly added item, "Rename"). */
  renamingItemId: string | null;
  /** Column header being renamed, in the header row of one group. */
  renamingColumn: { groupId: string; columnId: string } | null;
  /** Column whose settings popover is open, anchored on a group's header. */
  settingsFor: { groupId: string; columnId: string } | null;
  search: string;
  searchOpen: boolean;
  sort: SortState | null;
  /** Parent items whose subitem block is open (in memory only, per board). */
  expanded: ReadonlySet<string>;
  /** True while a group is being dragged: every group shows collapsed. */
  draggingGroup: boolean;
  /** Where a dragged item would land in another group (a blue line on that row). */
  dropMarker: DropMarker | null;
  /** Groups added here whose write has not come back in a board snapshot yet (shown at once). */
  pendingGroups: readonly GroupDef[];
  /** The group whose title opens in edit mode when it mounts (a freshly added group). */
  renamingGroupId: string | null;

  reset: (boardId: string | null) => void;
  setSelected: (ids: ReadonlySet<string>) => void;
  toggleSelected: (id: string) => void;
  setGroupSelected: (ids: readonly string[], on: boolean) => void;
  clearSelection: () => void;
  setActive: (cell: CellRef | null) => void;
  setEditing: (cell: CellRef | null) => void;
  setRenamingItem: (id: string | null) => void;
  setRenamingColumn: (value: TableState['renamingColumn']) => void;
  setSettingsFor: (value: TableState['settingsFor']) => void;
  setSearch: (search: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSort: (sort: SortState | null) => void;
  setDraggingGroup: (dragging: boolean) => void;
  toggleExpanded: (itemId: string, on?: boolean) => void;
  setDropMarker: (marker: DropMarker | null) => void;
  addPendingGroup: (group: GroupDef) => void;
  removePendingGroup: (id: string) => void;
  setRenamingGroup: (id: string | null) => void;
}

const NONE: ReadonlySet<string> = new Set();

export const useTableStore = create<TableState>()((set) => ({
  boardId: null,
  selected: NONE,
  active: null,
  editing: null,
  renamingItemId: null,
  renamingColumn: null,
  settingsFor: null,
  search: '',
  searchOpen: false,
  sort: null,
  expanded: NONE,
  draggingGroup: false,
  dropMarker: null,
  pendingGroups: [],
  renamingGroupId: null,

  reset: (boardId) =>
    set({
      boardId,
      selected: NONE,
      active: null,
      editing: null,
      renamingItemId: null,
      renamingColumn: null,
      settingsFor: null,
      search: '',
      searchOpen: false,
      sort: null,
      expanded: NONE,
      draggingGroup: false,
      dropMarker: null,
      pendingGroups: [],
      renamingGroupId: null,
    }),
  setSelected: (selected) => set({ selected }),
  toggleSelected: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (!next.delete(id)) next.add(id);
      return { selected: next };
    }),
  setGroupSelected: (ids, on) =>
    set((s) => {
      const next = new Set(s.selected);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return { selected: next };
    }),
  clearSelection: () => set({ selected: NONE }),
  setActive: (active) => set({ active }),
  setEditing: (editing) => set(editing ? { editing, active: editing } : { editing: null }),
  setRenamingItem: (renamingItemId) => set({ renamingItemId }),
  setRenamingColumn: (renamingColumn) => set({ renamingColumn }),
  setSettingsFor: (settingsFor) => set({ settingsFor }),
  setSearch: (search) => set({ search }),
  setSearchOpen: (searchOpen) => set(searchOpen ? { searchOpen } : { searchOpen, search: '' }),
  setSort: (sort) => set({ sort }),
  setDraggingGroup: (draggingGroup) => set({ draggingGroup }),
  toggleExpanded: (itemId, on) =>
    set((s) => {
      const next = new Set(s.expanded);
      const open = on ?? !next.has(itemId);
      if (open) next.add(itemId);
      else next.delete(itemId);
      return { expanded: next };
    }),
  setDropMarker: (dropMarker) => set({ dropMarker }),
  addPendingGroup: (group) => set((s) => ({ pendingGroups: [...s.pendingGroups, group] })),
  removePendingGroup: (id) =>
    set((s) => ({
      pendingGroups: s.pendingGroups.filter((g) => g.id !== id),
      renamingGroupId: s.renamingGroupId === id ? null : s.renamingGroupId,
    })),
  setRenamingGroup: (renamingGroupId) => set({ renamingGroupId }),
}));

/** Per-user table preferences that are not shared with the board: collapsed groups, name width. */
interface PrefsState {
  collapsed: Record<string, string[]>;
  nameWidth: Record<string, number>;
  setGroupCollapsed: (boardId: string, groupId: string, collapsed: boolean) => void;
  setManyCollapsed: (boardId: string, groupIds: readonly string[], collapsed: boolean) => void;
  setNameWidth: (boardId: string, width: number) => void;
}

export const useTablePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      collapsed: {},
      nameWidth: {},
      setGroupCollapsed: (boardId, groupId, collapsed) =>
        set((s) => {
          const current = new Set(s.collapsed[boardId] ?? []);
          if (collapsed) current.add(groupId);
          else current.delete(groupId);
          return { collapsed: { ...s.collapsed, [boardId]: [...current] } };
        }),
      setManyCollapsed: (boardId, groupIds, collapsed) =>
        set((s) => ({
          collapsed: { ...s.collapsed, [boardId]: collapsed ? [...groupIds] : [] },
        })),
      setNameWidth: (boardId, width) =>
        set((s) => ({ nameWidth: { ...s.nameWidth, [boardId]: width } })),
    }),
    { name: 'atrium.table', version: 1 },
  ),
);
