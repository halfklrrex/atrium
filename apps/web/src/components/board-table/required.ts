import { isColumnValueEmpty, type ColumnDef } from '@atrium/shared';
import { isClientReadOnlyType } from './derived';

/** Text of the soft hint an empty required cell shows. Nothing is blocked (see the column spec). */
export const REQUIRED_HINT = 'Required';

/**
 * True when the column is marked required and the item has no value for it. Derived and
 * server-managed columns are never filled by a person, so they never show the hint.
 */
export function isRequiredEmpty(def: ColumnDef, raw: unknown): boolean {
  if (!def.required || isClientReadOnlyType(def.type)) return false;
  return isColumnValueEmpty(def.type, raw);
}
