import { Button, Dropdown, IconButton, TextField } from '@vibe/core';
import { Add, Delete, Filter } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import type { ColumnDef, FilterCondition, FilterOperator } from '@atrium/shared';
import { useAuth } from '../../auth/auth-context';
import { UNKNOWN_PERSON_NAME, useUserLookup, useWorkspaceMembers } from '../../data/members-store';
import type { BoardDoc } from '../../data/model';
import { Popover } from '../Popover';
import styles from './board-filters.module.css';
import { useBoardFilter } from './filter-store';

const EMPTY_COLUMNS: readonly ColumnDef[] = [];

type DropdownOption = { value: string; label: string };

function toOption(selected: unknown): DropdownOption | null {
  if (!selected) return null;
  if (Array.isArray(selected)) return (selected[0] as DropdownOption) ?? null;
  return selected as DropdownOption;
}

const OPERATORS_FOR_TEXT: readonly { label: string; value: FilterOperator }[] = [
  { label: 'is', value: 'is' },
  { label: 'is not', value: 'is_not' },
  { label: 'contains', value: 'contains' },
  { label: 'does not contain', value: 'does_not_contain' },
  { label: 'is empty', value: 'is_empty' },
  { label: 'is not empty', value: 'is_not_empty' },
];

const OPERATORS_FOR_NUMERIC: readonly { label: string; value: FilterOperator }[] = [
  { label: 'is', value: 'is' },
  { label: 'is not', value: 'is_not' },
  { label: 'greater than', value: 'greater_than' },
  { label: 'less than', value: 'less_than' },
  { label: 'is empty', value: 'is_empty' },
  { label: 'is not empty', value: 'is_not_empty' },
];

const OPERATORS_FOR_CHECKBOX: readonly { label: string; value: FilterOperator }[] = [
  { label: 'is', value: 'is' },
  { label: 'is not', value: 'is_not' },
  { label: 'is empty', value: 'is_empty' },
  { label: 'is not empty', value: 'is_not_empty' },
];

function getOperatorsForColumn(
  type: string | undefined,
): readonly { label: string; value: FilterOperator }[] {
  if (type === 'numbers' || type === 'date') return OPERATORS_FOR_NUMERIC;
  if (type === 'checkbox') return OPERATORS_FOR_CHECKBOX;
  return OPERATORS_FOR_TEXT;
}

export interface AdvancedFilterPopoverProps {
  board?: BoardDoc | null;
  userLookup?: (uid: string) => string | undefined;
}

export function AdvancedFilterPopover({ board, userLookup }: AdvancedFilterPopoverProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const {
    filterState,
    addCondition,
    updateCondition,
    removeCondition,
    setConjunction,
    resetFilters,
  } = useBoardFilter(board?.id);

  const { filterGroup } = filterState;
  const conditions = filterGroup.conditions;
  const conditionCount = conditions.length;

  const { members } = useWorkspaceMembers(board?.workspaceId);
  const availablePeople = useMemo(() => {
    const set = new Set<string>(members.map((m) => m.id));
    if (user?.uid) set.add(user.uid);
    return Array.from(set);
  }, [members, user]);

  const handleAddRule = () => {
    const defaultColId = board?.columns[0]?.id ?? 'name';
    addCondition({
      columnId: defaultColId,
      operator: 'is',
      value: '',
    });
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Filter board items"
      trigger={
        <Button
          kind="tertiary"
          size="small"
          leftIcon={Filter}
          className={classNames(conditionCount > 0 && styles.activeButton)}
          onClick={() => setOpen((v) => !v)}
          aria-label="Filter"
        >
          Filter
          {conditionCount > 0 ? <span className={styles.badge}>{conditionCount}</span> : null}
        </Button>
      }
    >
      <div className={classNames(styles.popoverPanel, styles.filterPanel)}>
        <div className={styles.popoverHeader}>
          <span className={styles.popoverTitle}>Filter rules</span>
          {conditions.length > 1 ? (
            <div className={styles.matchConjunction}>
              <span>Match</span>
              <Button
                kind="tertiary"
                size="small"
                onClick={() => setConjunction(filterGroup.conjunction === 'and' ? 'or' : 'and')}
              >
                {filterGroup.conjunction === 'and' ? 'ALL rules' : 'ANY rule'}
              </Button>
            </div>
          ) : null}
        </div>

        {conditions.length === 0 ? (
          <div className={styles.emptyState}>No filter rules added yet.</div>
        ) : (
          <div>
            {conditions.map((condition, index) => (
              <FilterConditionRow
                key={index}
                index={index}
                condition={condition}
                board={board}
                availablePeople={availablePeople}
                userLookup={userLookup}
                onUpdate={(patch) => updateCondition(index, patch)}
                onRemove={() => removeCondition(index)}
              />
            ))}
          </div>
        )}

        <div className={styles.footerActions}>
          <Button kind="tertiary" size="small" leftIcon={Add} onClick={handleAddRule}>
            Add rule
          </Button>

          {conditionCount > 0 ? (
            <Button kind="tertiary" size="small" onClick={resetFilters}>
              Clear all
            </Button>
          ) : null}
        </div>
      </div>
    </Popover>
  );
}

function FilterConditionRow({
  condition,
  board,
  availablePeople,
  userLookup,
  onUpdate,
  onRemove,
}: {
  index: number;
  condition: FilterCondition;
  board?: BoardDoc | null;
  availablePeople: string[];
  userLookup?: (uid: string) => string | undefined;
  onUpdate: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const columns = board?.columns ?? EMPTY_COLUMNS;
  const selectedCol = columns.find((c) => c.id === condition.columnId);
  const colType = condition.columnId === 'name' ? 'text' : selectedCol?.type;
  const operators = getOperatorsForColumn(colType);

  const colOptions = useMemo(
    () => [
      { value: 'name', label: 'Item name' },
      ...columns.map((c) => ({ value: c.id, label: c.title })),
    ],
    [columns],
  );

  const operatorOptions = useMemo(
    () => operators.map((op) => ({ value: op.value, label: op.label })),
    [operators],
  );

  const handleColumnChange = (nextColId: string) => {
    const nextCol = columns.find((c) => c.id === nextColId);
    const nextType = nextColId === 'name' ? 'text' : nextCol?.type;
    const nextOps = getOperatorsForColumn(nextType);
    const nextOp = nextOps[0]?.value ?? 'is';
    onUpdate({ columnId: nextColId, operator: nextOp, value: '' });
  };

  const isBlankOperator =
    condition.operator === 'is_empty' || condition.operator === 'is_not_empty';

  return (
    <div className={styles.filterRuleRow} role="group" aria-label="Filter rule">
      {/* Column Selector */}
      <div className={styles.ruleDropdown}>
        <Dropdown
          size="small"
          clearable={false}
          placeholder="Select column"
          aria-label="Filter column"
          options={colOptions}
          value={colOptions.find((o) => o.value === condition.columnId) ?? colOptions[0]}
          onChange={(selected: unknown) => {
            const opt = toOption(selected);
            if (opt) handleColumnChange(opt.value);
          }}
        />
      </div>

      {/* Operator Selector */}
      <div className={styles.ruleDropdownNarrow}>
        <Dropdown
          size="small"
          clearable={false}
          aria-label="Filter operator"
          options={operatorOptions}
          value={operatorOptions.find((o) => o.value === condition.operator) ?? operatorOptions[0]}
          onChange={(selected: unknown) => {
            const opt = toOption(selected);
            if (opt) onUpdate({ operator: opt.value as FilterOperator });
          }}
        />
      </div>

      {/* Value Input */}
      {!isBlankOperator ? (
        <ConditionValueInput
          colType={colType}
          column={selectedCol}
          availablePeople={availablePeople}
          userLookup={userLookup}
          value={condition.value}
          onChange={(val) => onUpdate({ value: val })}
        />
      ) : (
        <div className={styles.ruleInput} />
      )}

      {/* Delete Rule */}
      <IconButton
        aria-label="Remove rule"
        icon={Delete}
        size="small"
        kind="tertiary"
        onClick={onRemove}
      />
    </div>
  );
}

function ConditionValueInput({
  colType,
  column,
  availablePeople,
  userLookup,
  value,
  onChange,
}: {
  colType?: string;
  column?: { settings?: Record<string, unknown> };
  availablePeople: string[];
  userLookup?: (uid: string) => string | undefined;
  value?: unknown;
  onChange: (val: unknown) => void;
}) {
  const memberLookup = useUserLookup();

  if (colType === 'status') {
    const labels = (column?.settings?.labels as { id: string; label: string }[]) || [];
    const options = labels.map((l) => ({ value: l.label, label: l.label }));
    return (
      <div className={styles.ruleDropdown}>
        <Dropdown
          size="small"
          clearable={false}
          placeholder="Select status..."
          aria-label="Status value"
          options={options}
          value={options.find((o) => o.value === String(value ?? '')) ?? undefined}
          onChange={(selected: unknown) => {
            const opt = toOption(selected);
            onChange(opt ? opt.value : '');
          }}
        />
      </div>
    );
  }

  if (colType === 'dropdown') {
    const labels = (column?.settings?.labels as { id: number; label: string }[]) || [];
    const options = labels.map((l) => ({ value: l.label, label: l.label }));
    return (
      <div className={styles.ruleDropdown}>
        <Dropdown
          size="small"
          clearable={false}
          placeholder="Select option..."
          aria-label="Dropdown value"
          options={options}
          value={options.find((o) => o.value === String(value ?? '')) ?? undefined}
          onChange={(selected: unknown) => {
            const opt = toOption(selected);
            onChange(opt ? opt.value : '');
          }}
        />
      </div>
    );
  }

  if (colType === 'checkbox') {
    const options = [
      { value: 'checked', label: 'Checked' },
      { value: 'unchecked', label: 'Unchecked' },
    ];
    const isUnchecked = value === false || value === 'false' || value === 'unchecked';
    const selectedOption = isUnchecked ? options[1] : options[0];
    return (
      <div className={styles.ruleDropdown}>
        <Dropdown
          size="small"
          clearable={false}
          aria-label="Checkbox value"
          options={options}
          value={selectedOption}
          onChange={(selected: unknown) => {
            const opt = toOption(selected);
            onChange(opt ? opt.value === 'checked' : true);
          }}
        />
      </div>
    );
  }

  if (colType === 'people') {
    const peopleOptions = (availablePeople || []).map((uid) => ({
      value: uid,
      label: userLookup?.(uid) ?? memberLookup(uid)?.name ?? UNKNOWN_PERSON_NAME,
    }));
    return (
      <div className={styles.ruleDropdown}>
        <Dropdown
          size="small"
          clearable={false}
          placeholder="Select person..."
          aria-label="People value"
          options={peopleOptions}
          value={peopleOptions.find((o) => o.value === String(value ?? '')) ?? undefined}
          onChange={(selected: unknown) => {
            const opt = toOption(selected);
            onChange(opt ? opt.value : '');
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.ruleInput}>
      <TextField
        size="small"
        inputAriaLabel="Filter value"
        placeholder={
          colType === 'numbers' ? 'e.g. 10' : colType === 'date' ? 'YYYY-MM-DD' : 'Value...'
        }
        value={String(value ?? '')}
        onChange={(val: string) =>
          onChange(colType === 'numbers' ? (val === '' ? '' : Number(val)) : val)
        }
      />
    </div>
  );
}
