import {
  columnRegistry,
  validateButtonActions,
  type ButtonAction,
  type GroupDef,
} from '@atrium/shared';
import { getColumnUi } from '../../columns/registry';
import type { ColumnView } from './table-model';

/** A column a `set_value` action may write: a plain type with an editor, never derived or managed. */
export function isWritableByButton(column: ColumnView): boolean {
  const { type } = column.def;
  return (
    columnRegistry.has(type) &&
    type !== 'button' &&
    !columnRegistry.isDerived(type) &&
    !columnRegistry.isServerManaged(type) &&
    !column.def.migrating &&
    (getColumnUi(type)?.editor ?? 'none') !== 'none'
  );
}

/**
 * One error message (or `null`) per action: a deleted column or group, an unset value, or the
 * reason `validateButtonActions` gives. Saving is blocked while any is set.
 */
export function getButtonActionErrors(
  actions: readonly ButtonAction[],
  columns: readonly ColumnView[],
  groups: readonly Pick<GroupDef, 'id'>[],
  options: { automation?: boolean } = {},
): (string | null)[] {
  const board = { columns: columns.map((c) => c.def), groups };
  return actions.map((action) => {
    if (action.type === 'set_value') {
      if (!columns.some((c) => c.def.id === action.columnId)) return 'This column was deleted';
      if (action.value === undefined) return 'Choose a value, or clear the cell';
    }
    if (action.type === 'move_to_group' && !groups.some((g) => g.id === action.groupId)) {
      return 'This group was deleted';
    }
    if (action.type === 'rename_item' && action.template.trim() === '') {
      return 'Enter a new name';
    }
    const checked = validateButtonActions([action], board, undefined, columnRegistry, options);
    if (checked.ok) return null;
    const at = checked.message.indexOf('): ');
    const reason = at === -1 ? checked.message : checked.message.slice(at + 3);
    return reason.charAt(0).toUpperCase() + reason.slice(1);
  });
}
