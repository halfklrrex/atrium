import type { Item } from '../schemas/item';

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
  value?: unknown;
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
  searchQuery?: string;
  personIds: string[];
  filterGroup: FilterGroup;
  sortConditions: SortCondition[];
  groupByColumnId: string | null;
}

export interface GroupedItems<T = Item> {
  groupId: string;
  groupTitle: string;
  groupColor?: string;
  items: T[];
}
