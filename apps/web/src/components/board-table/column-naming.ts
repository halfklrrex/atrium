import { columnRegistry } from '@atrium/shared';

/**
 * Title for a new column: the type's name ("Status", "Long text"...), or with a number appended
 * when a column already has that title ("Status 1", "Status 2"...). Matching ignores case.
 */
export function defaultColumnTitle(type: string, existingTitles: readonly string[]): string {
  const base = columnRegistry.find(type)?.label ?? 'Column';
  const taken = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 1; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Title for a duplicated column: "Status copy", then "Status copy 1"... */
export function duplicateColumnTitle(title: string, existingTitles: readonly string[]): string {
  const base = `${title} copy`.slice(0, 116);
  const taken = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 1; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
