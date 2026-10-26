# P1c: Board filter, sort, search & group-by

Author: Antigravity · Implementer: Antigravity · Roadmap: P1 "Board filter, sort, search & group-by" · Branch: `ag/board-filters-sort`

## Summary

In monday.com, board toolbars provide instant client-side filtering, sorting, searching, and dynamic grouping across all items on a board. This epic delivers the complete filtering, sorting, and grouping engine along with its toolbar UI controls.

Target: `docs/reference/monday/01-board-table.jpg` and `docs/reference/monday-ui-reference.md` §Toolbar.

---

## 1. Filter & Sort Engine (`packages/shared/src/filters/`)

### 1.1 Types & Schema

```ts
export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than';

export interface FilterCondition {
  columnId: string;
  operator: FilterOperator;
  value: unknown;
}

export interface FilterGroup {
  conjunction: 'and' | 'or';
  conditions: FilterCondition[];
}

export interface SortCondition {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface BoardFilterState {
  searchQuery: string;
  personIds: string[]; // quick filter by assigned person
  filterGroup: FilterGroup;
  sortConditions: SortCondition[];
  groupByColumnId: string | null; // null = board default groups
}
```

### 1.2 Pure Evaluation Functions

- `evaluateCondition(item, condition, columnRegistry)`: tests an item against a condition.
  - Checkbox column: evaluated directly for boolean state (`checked === targetChecked`), ensuring "is unchecked" matches falsy, `{ checked: 'false' }`, and empty cells.
  - Date column: safely guards values without `.date` property.
- `matchesFilter(item, filterGroup, searchQuery, personFilter, columnRegistry)`: returns boolean.
- `sortItems(items, sortConditions, columns, columnRegistry)`: multi-column stable sort with tie-breaking when primary sort values are empty.
- `groupItems(items, groupByColumnId, columnDef, registry, userLookup)`: dynamically clusters items into synthetic groups when `groupByColumnId` is active, resolving user names for people columns.
- `GroupModel.synthetic`: marks dynamic groups constructed via `groupByColumnId`. Synthetic groups have title editing disabled, hide the group options menu, and disable `AddItemRow` to prevent orphan items.
- Unified Sort: `filterState.sortConditions` is the single source of truth for both the Sort popover and table header sort indicators/actions.

---

## 2. UI Components & Store (`apps/web/src/components/board-filters/`)

### 2.1 Zustand Store (`filter-store.ts`)

- Manages filter/sort/search/group-by state per board.
- Provides actions: `setSearchQuery`, `togglePersonFilter`, `addCondition`, `removeCondition`, `setSort`, `setGroupBy`, `resetFilters`.

### 2.2 Toolbar Controls

- **`BoardToolbar.tsx`:**
  - Integrates with the board page toolbar.
  - Controls: Search input, "Person" button with active count badge, "Filter" split button, "Sort" button, "Group by" button.
- **`PersonFilterPopover.tsx`:**
  - Displays avatars and names of all people assigned to items on this board.
  - Clicking an avatar toggles filtering by that person.
- **`AdvancedFilterPopover.tsx`:**
  - Visual condition builder:
    - Add rule (+ New filter).
    - Conjunction toggle (Match ALL / Match ANY).
    - Column dropdown, operator dropdown, value input/picker.
    - Clear all filters button.
- **`SortPopover.tsx`:**
  - Add sort column, Ascending / Descending toggle, multi-level sort ordering.
- **`GroupByPopover.tsx`:**
  - Select column to group by (Default groups, Status, Person, Date...).

---

## 3. Verification & Tests

- Comprehensive unit tests in `packages/shared/src/filters/filters.test.ts`:
  - Testing all operators (`is`, `contains`, `empty`, numeric comparison) across text, status, numbers, date, people.
  - Conjunctions (AND vs OR).
  - Multi-column sort order and stability.
  - Group-by clustering logic.
- Component tests for `BoardToolbar`, `PersonFilterPopover`, `AdvancedFilterPopover`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` pass.
