import { columnRegistry, type PeopleValue } from '@atrium/shared';
import { UNKNOWN_PERSON_NAME } from '../data/members-store';

export interface CellDisplayNames {
  /** A person's display name, or `undefined`/`null` when unknown. */
  personName?: (uid: string) => string | null | undefined;
  /** A team's name; without it (or when unknown) a team reads as "a team". */
  teamName?: (id: string) => string | null | undefined;
}

/**
 * A cell value as text for people to read. The registry's `toText` lists ids for a people cell
 * (shared code can't resolve names), so this resolves them here; every other type falls back to
 * `columnRegistry.toText`. Throws like `toText` does for a malformed value.
 */
export function cellDisplayText(
  type: string,
  value: unknown,
  settings: unknown,
  names: CellDisplayNames = {},
): string {
  if (type === 'people' && columnRegistry.has('people')) {
    const parsed = columnRegistry.parseValue('people', value);
    if (!parsed.success) return '';
    const { personsAndTeams } = parsed.data as PeopleValue;
    return personsAndTeams
      .map((p) =>
        p.kind === 'team'
          ? (names.teamName?.(p.id) ?? 'a team')
          : (names.personName?.(p.id) ?? UNKNOWN_PERSON_NAME),
      )
      .join(', ');
  }
  return columnRegistry.toText(type, value, settings);
}
