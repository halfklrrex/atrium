import { describe, expect, it } from 'vitest';
import { formatRelativeShort, formatUpdated, initialsOf } from './format';
import { dayPartAt, firstNameOf, greetingFor } from './greeting';
import { newSlugId } from './ids';
import {
  comparePositions,
  positionAfterAll,
  positionAtIndex,
  positionBeforeAll,
  positionBetween,
} from './positions';

describe('greeting', () => {
  it('picks the part of the day with monday boundaries', () => {
    expect(dayPartAt(4)).toBe('night');
    expect(dayPartAt(5)).toBe('morning');
    expect(dayPartAt(11)).toBe('morning');
    expect(dayPartAt(12)).toBe('afternoon');
    expect(dayPartAt(16)).toBe('afternoon');
    expect(dayPartAt(17)).toBe('evening');
    expect(dayPartAt(20)).toBe('evening');
    expect(dayPartAt(21)).toBe('night');
    expect(dayPartAt(0)).toBe('night');
  });

  it('greets by first name', () => {
    expect(greetingFor(new Date(2026, 9, 23, 19, 0), 'Avery')).toBe('Good evening, Avery!');
    expect(greetingFor(new Date(2026, 9, 23, 8, 0), 'Ada')).toBe('Good morning, Ada!');
    expect(greetingFor(new Date(2026, 9, 23, 14, 0), null)).toBe('Good afternoon!');
  });

  it('takes the first name from the display name or the email', () => {
    expect(firstNameOf('Avery Quinn', 'avery@example.com')).toBe('Avery');
    expect(firstNameOf('  ', 'grace@example.com')).toBe('grace');
    expect(firstNameOf(null, null)).toBeNull();
  });
});

describe('positions', () => {
  const item = (id: string, position: string) => ({ id, position });

  it('sorts by plain code-unit order with an id tie-break', () => {
    const list = [item('b', 'a1'), item('c', 'a0'), item('a', 'a1'), item('d', 'Zz')];
    expect(list.sort(comparePositions).map((i) => i.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('generates keys before, between and after', () => {
    const items = [item('a', 'a0'), item('b', 'a1')];
    expect(positionAfterAll(items) > 'a1').toBe(true);
    expect(positionBeforeAll(items) < 'a0').toBe(true);
    const mid = positionAtIndex(items, 1);
    expect(mid > 'a0' && mid < 'a1').toBe(true);
    expect(positionAfterAll([])).toBeTruthy();
  });

  it('survives neighbours with equal keys instead of throwing', () => {
    expect(positionBetween('a1', 'a1') > 'a1').toBe(true);
  });
});

describe('formatting helpers', () => {
  const at = (ms: number) => ({ toMillis: () => ms });
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);

  it('describes recent updates relatively and old ones by date', () => {
    expect(formatUpdated(at(now - 10_000), now, 'en')).toBe('just now');
    expect(formatUpdated(at(now - 5 * 60_000), now, 'en')).toBe('5 minutes ago');
    expect(formatUpdated(at(now - 3 * 3_600_000), now, 'en')).toBe('3 hours ago');
    expect(formatUpdated(at(now - 2 * 86_400_000), now, 'en')).toBe('2 days ago');
    expect(formatUpdated(at(now - 30 * 86_400_000), now, 'en')).toMatch(/2026/);
    expect(formatUpdated(null)).toBe('');
  });

  it('formats compact monday-style ages', () => {
    expect(formatRelativeShort(at(now - 10_000), now)).toBe('now');
    expect(formatRelativeShort(at(now - 5 * 60_000), now)).toBe('5m');
    expect(formatRelativeShort(at(now - 17 * 3_600_000), now)).toBe('17h');
    expect(formatRelativeShort(at(now - 86_400_000), now)).toBe('1d');
    expect(formatRelativeShort(at(now - 21 * 86_400_000), now)).toBe('3w');
    expect(formatRelativeShort(at(now - 800 * 86_400_000), now)).toBe('2y');
    expect(formatRelativeShort(null)).toBe('');
  });

  it('builds initials', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('grace')).toBe('G');
  });

  it('creates slug ids that satisfy the board schema pattern', () => {
    const id = newSlugId();
    expect(id).toMatch(/^[a-z0-9]{10}$/);
    expect(newSlugId()).not.toBe(id);
  });
});
