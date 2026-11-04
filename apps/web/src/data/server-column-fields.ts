import { withoutServerColumnFields, type ColumnDef } from '@atrium/shared';

// Lives in the shared package so templates can strip the same fields; re-exported for the web.
export { withoutServerColumnFields };

/**
 * `migrating` and `lastTypeChange` on a column def are written only by the changeColumnType and
 * revertColumnType Cloud Functions. Firestore rules cannot look inside `columns[]` entries, so the
 * web never sends them: `columns` keeps whatever the server has stored for each id, and a column
 * without a stored mark (a new or duplicated one) carries none.
 */
export function keepServerColumnFields(
  next: readonly ColumnDef[],
  current: readonly ColumnDef[],
): ColumnDef[] {
  const byId = new Map(current.map((c) => [c.id, c]));
  return next.map((column) => {
    const { migrating: _m, lastTypeChange: _l, ...rest } = column;
    void _m;
    void _l;
    const stored = byId.get(column.id);
    return {
      ...rest,
      ...(stored?.migrating ? { migrating: stored.migrating } : {}),
      ...(stored?.lastTypeChange ? { lastTypeChange: stored.lastTypeChange } : {}),
    };
  });
}
