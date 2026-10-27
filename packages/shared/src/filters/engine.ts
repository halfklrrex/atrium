import {
  columnRegistry,
  findStatusLabel,
  isChecked,
  numericOf,
  type CheckboxValue,
  type ColumnTypeRegistry,
  type DateValue,
  type DropdownSettings,
  type DropdownValue,
  type NumbersValue,
  type PeopleValue,
  type StatusSettings,
  type StatusValue,
} from '../columns';
import type { ColumnDef } from '../schemas/board';
import type { Item } from '../schemas/item';
import type {
  BoardFilterState,
  FilterCondition,
  FilterGroup,
  GroupedItems,
  SortCondition,
} from './types';

/**
 * The value a cell shows for filtering, search and sort: the computed value for derived columns
 * (nothing is stored for them), the stored `values.<id>` otherwise.
 */
function cellValue(
  item: Item,
  col: ColumnDef,
  columns: readonly ColumnDef[],
  registry: ColumnTypeRegistry,
): unknown {
  if (!registry.isDerived(col.type)) return item.values?.[col.id];
  const withId = item as Item & { id?: string; seq?: number; boardSeq?: number };
  return registry.computeValue(col, {
    boardId: '',
    item: {
      id: withId.id ?? '',
      values: item.values ?? {},
      createdAt: item.createdAt,
      createdBy: item.createdBy,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy,
      groupId: item.groupId,
      seq: withId.seq,
      boardSeq: withId.boardSeq,
    },
    columns,
  });
}

const DEFAULT_GROUP_COLORS = [
  '#00c875',
  '#fdab3d',
  '#579bfc',
  '#df2f4a',
  '#a25ddc',
  '#0086c0',
  '#784bd1',
  '#ff5ac4',
  '#ff642e',
  '#9cd326',
  '#66ccff',
  '#bb3354',
];

export function createDefaultFilterState(): BoardFilterState {
  return {
    searchQuery: '',
    personIds: [],
    filterGroup: {
      conjunction: 'and',
      conditions: [],
    },
    sortConditions: [],
    groupByColumnId: null,
  };
}

/** Evaluates a single filter condition on an item. */
export function evaluateCondition(
  item: Item,
  condition: FilterCondition,
  columns: readonly ColumnDef[],
  registry: ColumnTypeRegistry = columnRegistry,
): boolean {
  const { columnId, operator, value } = condition;

  // An incomplete condition with no operator or empty value for value-based operators is ignored (matches).
  if (
    operator !== 'is_empty' &&
    operator !== 'is_not_empty' &&
    (value === undefined || value === null || value === '')
  ) {
    return true;
  }

  // 1. Column is 'name' (the primary Item name)
  if (columnId === 'name') {
    const itemName = item.name ?? '';
    const isEmpty = itemName.trim() === '';
    if (operator === 'is_empty') return isEmpty;
    if (operator === 'is_not_empty') return !isEmpty;

    const targetStr = String(value ?? '')
      .trim()
      .toLowerCase();
    const itemStr = itemName.trim().toLowerCase();

    switch (operator) {
      case 'is':
        return itemStr === targetStr;
      case 'is_not':
        return itemStr !== targetStr;
      case 'contains':
        return itemStr.includes(targetStr);
      case 'does_not_contain':
        return !itemStr.includes(targetStr);
      case 'greater_than':
        return (
          itemStr.localeCompare(targetStr, undefined, { numeric: true, sensitivity: 'base' }) > 0
        );
      case 'less_than':
        return (
          itemStr.localeCompare(targetStr, undefined, { numeric: true, sensitivity: 'base' }) < 0
        );
      default:
        return true;
    }
  }

  // 2. Custom column
  const col = columns.find((c) => c.id === columnId);
  if (!col) return true;

  const rawVal = cellValue(item, col, columns, registry);

  // Checkbox column handles boolean states directly (unchecked is a valid false state, not merely empty)
  if (col.type === 'checkbox') {
    const checked = Boolean(rawVal && isChecked(rawVal as CheckboxValue));
    const targetChecked =
      typeof value === 'boolean'
        ? value
        : String(value).trim().toLowerCase() === 'checked' ||
          String(value).trim().toLowerCase() === 'true';

    switch (operator) {
      case 'is':
        return checked === targetChecked;
      case 'is_not':
        return checked !== targetChecked;
      case 'is_empty':
        return !checked;
      case 'is_not_empty':
        return checked;
      case 'contains':
        return checked === targetChecked;
      case 'does_not_contain':
        return checked !== targetChecked;
      default:
        return true;
    }
  }

  // Check if cell is empty
  let isEmpty = rawVal === null || rawVal === undefined || rawVal === '';
  if (col.type === 'people') {
    isEmpty = isEmpty || !(rawVal as PeopleValue).personsAndTeams?.length;
  } else if (col.type === 'dropdown') {
    isEmpty = isEmpty || !(rawVal as DropdownValue).ids?.length;
  } else if (col.type === 'status') {
    const settings = (col.settings as StatusSettings) ?? { labels: [] };
    const label = rawVal ? findStatusLabel(rawVal as StatusValue, settings) : null;
    isEmpty = isEmpty || label === null;
  }

  if (operator === 'is_empty') return isEmpty;
  if (operator === 'is_not_empty') return !isEmpty;

  // For non-empty operators on an empty cell:
  if (isEmpty) {
    if (operator === 'is_not' || operator === 'does_not_contain') {
      return true;
    }
    return false;
  }

  // Value comparisons per column type
  if (col.type === 'status') {
    const settings = (col.settings as StatusSettings) ?? { labels: [] };
    const label = findStatusLabel(rawVal as StatusValue, settings);
    const target = String(value).trim().toLowerCase();
    const matchesLabel =
      label !== null &&
      (label.id.toLowerCase() === target ||
        label.label.trim().toLowerCase() === target ||
        String(label.index) === target);
    const labelContains = label !== null && label.label.toLowerCase().includes(target);

    switch (operator) {
      case 'is':
        return matchesLabel;
      case 'is_not':
        return !matchesLabel;
      case 'contains':
        return labelContains;
      case 'does_not_contain':
        return !labelContains;
      case 'greater_than':
        return (label?.index ?? 0) > Number(value);
      case 'less_than':
        return (label?.index ?? 0) < Number(value);
      default:
        return true;
    }
  }

  if (col.type === 'numbers') {
    const n = numericOf(rawVal as NumbersValue);
    const targetN = Number(value);
    switch (operator) {
      case 'is':
        return n === targetN;
      case 'is_not':
        return n !== targetN;
      case 'contains':
        return String(n).includes(String(value));
      case 'does_not_contain':
        return !String(n).includes(String(value));
      case 'greater_than':
        return n > targetN;
      case 'less_than':
        return n < targetN;
      default:
        return true;
    }
  }

  if (col.type === 'date') {
    const d = (rawVal as DateValue | null | undefined)?.date;
    if (!d || typeof d !== 'string') return false;
    const targetD = String(value).trim();
    switch (operator) {
      case 'is':
        return d === targetD;
      case 'is_not':
        return d !== targetD;
      case 'contains':
        return d.includes(targetD);
      case 'does_not_contain':
        return !d.includes(targetD);
      case 'greater_than':
        return d > targetD;
      case 'less_than':
        return d < targetD;
      default:
        return true;
    }
  }

  if (col.type === 'people') {
    const people = (rawVal as PeopleValue).personsAndTeams || [];
    const targetStr = String(value).trim().toLowerCase();
    const hasPerson = people.some((p) => p.id.toLowerCase() === targetStr);
    const containsPerson = people.some((p) => p.id.toLowerCase().includes(targetStr));
    switch (operator) {
      case 'is':
        return hasPerson;
      case 'is_not':
        return !hasPerson;
      case 'contains':
        return containsPerson;
      case 'does_not_contain':
        return !containsPerson;
      case 'greater_than':
        return people.length > Number(value);
      case 'less_than':
        return people.length < Number(value);
      default:
        return true;
    }
  }

  if (col.type === 'dropdown') {
    const settings = col.settings as DropdownSettings;
    const dVal = rawVal as DropdownValue;
    const targetStr = String(value).trim().toLowerCase();
    const selectedLabels = (dVal.ids || [])
      .map((id) => settings.labels.find((l) => l.id === id)?.label)
      .filter((l): l is string => Boolean(l));
    const matchesDropdown =
      (dVal.ids || []).some((id) => String(id) === targetStr) ||
      selectedLabels.some((l) => l.trim().toLowerCase() === targetStr);
    const containsDropdown = selectedLabels.some((l) => l.toLowerCase().includes(targetStr));

    switch (operator) {
      case 'is':
        return matchesDropdown;
      case 'is_not':
        return !matchesDropdown;
      case 'contains':
        return containsDropdown;
      case 'does_not_contain':
        return !containsDropdown;
      default:
        return true;
    }
  }

  // Fallback (text, long_text, link, or custom types)
  const text = registry.toText(col.type, rawVal, col.settings).trim();
  const targetStr = String(value).trim().toLowerCase();
  const lowerText = text.toLowerCase();

  switch (operator) {
    case 'is':
      return lowerText === targetStr;
    case 'is_not':
      return lowerText !== targetStr;
    case 'contains':
      return lowerText.includes(targetStr);
    case 'does_not_contain':
      return !lowerText.includes(targetStr);
    case 'greater_than':
      return text.localeCompare(targetStr, undefined, { numeric: true, sensitivity: 'base' }) > 0;
    case 'less_than':
      return text.localeCompare(targetStr, undefined, { numeric: true, sensitivity: 'base' }) < 0;
    default:
      return true;
  }
}

/** Pure function evaluating items against search query, person quick filter, and advanced filter conditions. */
export function matchesFilter(
  item: Item,
  filterGroup?: FilterGroup | null,
  searchQuery?: string | null,
  personFilter?: readonly string[] | null,
  columns: readonly ColumnDef[] = [],
  registry: ColumnTypeRegistry = columnRegistry,
): boolean {
  // 1. Search Query
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    const nameMatch = (item.name ?? '').toLowerCase().includes(q);
    const colMatch = columns.some((col) => {
      const val = cellValue(item, col, columns, registry);
      if (val === null || val === undefined) return false;
      const text = registry.toText(col.type, val, col.settings);
      return text.toLowerCase().includes(q);
    });
    if (!nameMatch && !colMatch) return false;
  }

  // 2. Person Filter (quick filter by member uids)
  if (personFilter && personFilter.length > 0) {
    const filterSet = new Set(personFilter);
    const hasAssigned = columns.some((col) => {
      if (col.type !== 'people') return false;
      const val = item.values?.[col.id] as PeopleValue | undefined;
      return val?.personsAndTeams?.some((p) => filterSet.has(p.id));
    });
    if (!hasAssigned) return false;
  }

  // 3. Filter Group (advanced rules)
  if (filterGroup && filterGroup.conditions.length > 0) {
    const { conjunction, conditions } = filterGroup;
    if (conjunction === 'or') {
      const anyMatches = conditions.some((cond) =>
        evaluateCondition(item, cond, columns, registry),
      );
      if (!anyMatches) return false;
    } else {
      const allMatch = conditions.every((cond) => evaluateCondition(item, cond, columns, registry));
      if (!allMatch) return false;
    }
  }

  return true;
}

/** Multi-column stable sorting of items. */
export function sortItems<T extends Item>(
  items: readonly T[],
  sortConditions: readonly SortCondition[],
  columns: readonly ColumnDef[] = [],
  registry: ColumnTypeRegistry = columnRegistry,
): T[] {
  if (!sortConditions || sortConditions.length === 0) {
    return [...items];
  }

  return [...items].sort((a, b) => {
    for (const condition of sortConditions) {
      if (condition.columnId === 'name' || condition.columnId === '__name__') {
        const aEmpty = !a.name || a.name.trim() === '';
        const bEmpty = !b.name || b.name.trim() === '';
        if (aEmpty !== bEmpty) {
          return aEmpty ? 1 : -1;
        }
        if (aEmpty && bEmpty) {
          continue;
        }
        const cmp = a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (cmp !== 0) {
          return condition.direction === 'desc' ? -cmp : cmp;
        }
      } else {
        const col = columns.find((c) => c.id === condition.columnId);
        if (col) {
          const aVal = cellValue(a, col, columns, registry);
          const bVal = cellValue(b, col, columns, registry);
          const aEmpty = aVal === null || aVal === undefined || aVal === '';
          const bEmpty = bVal === null || bVal === undefined || bVal === '';
          if (aEmpty !== bEmpty) {
            return aEmpty ? 1 : -1;
          }
          if (aEmpty && bEmpty) {
            continue;
          }
          const cmp = registry.compare(col.type, aVal, bVal, col.settings);
          if (cmp !== 0) {
            return condition.direction === 'desc' ? -cmp : cmp;
          }
        }
      }
    }
    return 0;
  });
}

/** Dynamic group clustering when grouping by a column (or natural group clustering). */
export function groupItems<T extends Item>(
  items: readonly T[],
  groupByColumnId: string | null,
  columnDef?: ColumnDef,
  registry: ColumnTypeRegistry = columnRegistry,
  userLookup?: (uid: string) => string | undefined,
): GroupedItems<T>[] {
  if (!groupByColumnId || !columnDef) {
    const groups = new Map<string, GroupedItems<T>>();
    for (const item of items) {
      const gid = item.groupId;
      let group = groups.get(gid);
      if (!group) {
        group = {
          groupId: gid,
          groupTitle: gid,
          items: [],
        };
        groups.set(gid, group);
      }
      group.items.push(item);
    }
    return Array.from(groups.values());
  }

  // 1. Group by Status column
  if (columnDef.type === 'status') {
    const settings = columnDef.settings as StatusSettings;
    const groups = new Map<string, GroupedItems<T>>();

    for (const label of settings.labels || []) {
      groups.set(label.id, {
        groupId: `status_${label.id}`,
        groupTitle: label.label,
        groupColor: label.color,
        items: [],
      });
    }

    groups.set('empty', {
      groupId: 'status_empty',
      groupTitle: 'Empty',
      groupColor: '#c4c4c4',
      items: [],
    });

    for (const item of items) {
      const val = item.values?.[columnDef.id] as StatusValue | undefined;
      const label = val ? findStatusLabel(val, settings) : null;
      if (label && groups.has(label.id)) {
        groups.get(label.id)!.items.push(item);
      } else {
        groups.get('empty')!.items.push(item);
      }
    }

    // Keep all label groups that have items or non-empty defined labels
    return Array.from(groups.values()).filter(
      (g) => g.items.length > 0 || g.groupId !== 'status_empty',
    );
  }

  // 2. Group by Checkbox column
  if (columnDef.type === 'checkbox') {
    const doneGroup: GroupedItems<T> = {
      groupId: 'check_done',
      groupTitle: 'Done',
      groupColor: '#00c875',
      items: [],
    };
    const notDoneGroup: GroupedItems<T> = {
      groupId: 'check_not_done',
      groupTitle: 'Not Done',
      groupColor: '#c4c4c4',
      items: [],
    };
    for (const item of items) {
      const val = item.values?.[columnDef.id] as CheckboxValue | undefined;
      if (val && isChecked(val)) {
        doneGroup.items.push(item);
      } else {
        notDoneGroup.items.push(item);
      }
    }
    return [doneGroup, notDoneGroup].filter((g) => g.items.length > 0);
  }

  // 3. Group by People column
  if (columnDef.type === 'people') {
    const groups = new Map<string, GroupedItems<T>>();
    let colorIdx = 0;
    for (const item of items) {
      const val = item.values?.[columnDef.id] as PeopleValue | undefined;
      const person = val?.personsAndTeams?.[0];
      const key = person?.id ?? 'unassigned';
      let group = groups.get(key);
      if (!group) {
        const title =
          key === 'unassigned'
            ? 'Unassigned'
            : (userLookup?.(key) ??
              (key.startsWith('u_') || key.length > 15 ? 'Board member' : key));
        group = {
          groupId: `person_${key}`,
          groupTitle: title,
          groupColor:
            key === 'unassigned'
              ? '#c4c4c4'
              : DEFAULT_GROUP_COLORS[colorIdx++ % DEFAULT_GROUP_COLORS.length],
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push(item);
    }
    return Array.from(groups.values());
  }

  // 4. Other columns (dropdown, date, numbers, text, link, etc.)
  const groups = new Map<string, GroupedItems<T>>();
  let colorIdx = 0;
  for (const item of items) {
    const val = item.values?.[columnDef.id];
    const text =
      val !== null && val !== undefined
        ? registry.toText(columnDef.type, val, columnDef.settings).trim()
        : '';
    const key = text === '' ? 'empty' : text;
    let group = groups.get(key);
    if (!group) {
      group = {
        groupId: `group_${key}`,
        groupTitle: key === 'empty' ? 'No value' : key,
        groupColor:
          key === 'empty'
            ? '#c4c4c4'
            : DEFAULT_GROUP_COLORS[colorIdx++ % DEFAULT_GROUP_COLORS.length],
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  return Array.from(groups.values());
}
