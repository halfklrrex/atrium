import { describe, expect, it } from 'vitest';
import { cellDisplayText } from './cell-display-text';

const people = {
  personsAndTeams: [
    { id: 'u1', kind: 'person' as const },
    { id: 'u2', kind: 'person' as const },
    { id: 't1', kind: 'team' as const },
  ],
};

describe('cellDisplayText', () => {
  it('resolves people to names, unknown people to the generic name, teams to their name', () => {
    expect(
      cellDisplayText(
        'people',
        people,
        {},
        {
          personName: (uid) => (uid === 'u1' ? 'Avery Quinn' : undefined),
          teamName: () => 'Design',
        },
      ),
    ).toBe('Avery Quinn, Board member, Design');
  });

  it('reads a team as "a team" without a resolver', () => {
    expect(cellDisplayText('people', people, {})).toBe('Board member, Board member, a team');
  });

  it('returns empty text for a malformed people value', () => {
    expect(cellDisplayText('people', { nope: true }, {})).toBe('');
  });

  it('falls back to the registry for other types', () => {
    expect(cellDisplayText('text', 'hello', {})).toBe('hello');
  });
});
