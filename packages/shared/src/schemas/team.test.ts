import { describe, expect, it } from 'vitest';
import { TEAM_LIMITS, teamInputSchema, teamSchema } from './team';

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000), toMillis: () => 1000 };
const doc = {
  name: 'Kids',
  color: '#579bfc',
  memberUids: ['u1', 'u2'],
  createdAt: ts,
  createdBy: 'u1',
  updatedAt: ts,
  updatedBy: 'u1',
};

describe('teamSchema', () => {
  it('accepts a valid team', () => {
    expect(teamSchema.safeParse(doc).success).toBe(true);
  });

  it('refuses a bad name, color, duplicate members and too many members', () => {
    expect(teamSchema.safeParse({ ...doc, name: '  ' }).success).toBe(false);
    expect(teamSchema.safeParse({ ...doc, name: 'x'.repeat(TEAM_LIMITS.name + 1) }).success).toBe(
      false,
    );
    expect(teamSchema.safeParse({ ...doc, color: 'blue' }).success).toBe(false);
    expect(teamSchema.safeParse({ ...doc, memberUids: ['u1', 'u1'] }).success).toBe(false);
    const many = Array.from({ length: TEAM_LIMITS.members + 1 }, (_, i) => `u${i}`);
    expect(teamSchema.safeParse({ ...doc, memberUids: many }).success).toBe(false);
  });

  it('requires updatedBy', () => {
    const { updatedBy: _omit, ...rest } = doc;
    expect(teamSchema.safeParse(rest).success).toBe(false);
  });
});

describe('teamInputSchema', () => {
  it('trims the name and allows an empty team', () => {
    const parsed = teamInputSchema.parse({ name: '  Kids ', color: '#579bfc', memberUids: [] });
    expect(parsed.name).toBe('Kids');
  });

  it('asks for a name', () => {
    const r = teamInputSchema.safeParse({ name: ' ', color: '#579bfc', memberUids: [] });
    expect(r.success).toBe(false);
  });
});
