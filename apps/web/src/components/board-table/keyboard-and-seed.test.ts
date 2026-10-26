import { defaultBoardStructure } from '@atrium/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newBoardSeedItems } from '../../data/seed-items';
import { GROUP_COLORS, STATUS_LABEL_COLORS, nextGroupColor } from '../../theme/palette';
import { moveActiveCell } from './table-keyboard';

describe('keyboard navigation', () => {
  const rows = ['r1', 'r2', 'r3'];
  const cols = ['name', 'status', 'date'];

  it('starts on the first cell', () => {
    expect(moveActiveCell(null, 'ArrowDown', rows, cols)).toEqual({
      itemId: 'r1',
      columnId: 'name',
    });
  });

  it('moves one cell at a time and stops at the edges', () => {
    const at = { itemId: 'r2', columnId: 'status' };
    expect(moveActiveCell(at, 'ArrowUp', rows, cols)).toEqual({ itemId: 'r1', columnId: 'status' });
    expect(moveActiveCell(at, 'ArrowLeft', rows, cols)).toEqual({ itemId: 'r2', columnId: 'name' });
    expect(moveActiveCell({ itemId: 'r3', columnId: 'date' }, 'ArrowDown', rows, cols)).toEqual({
      itemId: 'r3',
      columnId: 'date',
    });
    expect(moveActiveCell({ itemId: 'r1', columnId: 'name' }, 'ArrowLeft', rows, cols)).toEqual({
      itemId: 'r1',
      columnId: 'name',
    });
  });

  it('recovers when the active row or column is gone', () => {
    expect(moveActiveCell({ itemId: 'gone', columnId: 'old' }, 'ArrowRight', rows, cols)).toEqual({
      itemId: 'r1',
      columnId: 'status',
    });
    expect(moveActiveCell(null, 'ArrowDown', [], cols)).toBeNull();
  });
});

describe('sample items of a new board', () => {
  it('puts three items in the first group and two in the second, as monday does', () => {
    const structure = defaultBoardStructure(() => `g${Math.random()}`);
    const items = newBoardSeedItems(structure);
    const [first, second] = [...structure.groups].sort((a, b) =>
      a.position < b.position ? -1 : 1,
    );
    expect(items.map((i) => i.name)).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5']);
    expect(items.filter((i) => i.groupId === first!.id)).toHaveLength(3);
    expect(items.filter((i) => i.groupId === second!.id)).toHaveLength(2);
  });

  it('sets only the status of the first three: Working on it, Done, Stuck', () => {
    const structure = defaultBoardStructure(() => `g${Math.random()}`);
    const status = structure.columns.find((c) => c.type === 'status')!;
    const items = newBoardSeedItems(structure);
    expect(items.map((i) => i.values?.[status.id])).toEqual([
      { index: 0 },
      { index: 1 },
      { index: 2 },
      undefined,
      undefined,
    ]);
    expect(items.every((i) => Object.keys(i.values ?? {}).every((k) => k === status.id))).toBe(
      true,
    );
    const labels = (status.settings as { labels: { index: number; label: string }[] }).labels;
    expect(labels.filter((l) => [0, 1, 2].includes(l.index)).map((l) => l.label)).toEqual([
      'Working on it',
      'Done',
      'Stuck',
    ]);
  });

  it('gives every item a distinct position within its group', () => {
    const items = newBoardSeedItems(defaultBoardStructure(() => `g${Math.random()}`));
    const keys = items.map((i) => `${i.groupId}:${i.position}`);
    expect(new Set(keys).size).toBe(items.length);
  });
});

describe('table palettes', () => {
  const vibeCss = readFileSync(
    join(process.cwd(), 'node_modules/@vibe/core/dist/tokens/tokens.css'),
    'utf8',
  );

  it("offers monday's 20 group colours, all mirroring Vibe colour tokens", () => {
    expect(GROUP_COLORS).toHaveLength(20);
    expect(new Set(GROUP_COLORS.map((c) => c.hex)).size).toBe(20);
    for (const color of [...GROUP_COLORS, ...STATUS_LABEL_COLORS]) {
      const match = new RegExp(`--color-${color.name}:\\s*(#[0-9a-f]{6})`, 'i').exec(vibeCss);
      expect(match?.[1]?.toLowerCase(), `--color-${color.name}`).toBe(color.hex.toLowerCase());
    }
  });

  it('picks the next unused colour for a new group', () => {
    expect(nextGroupColor([])).toBe(GROUP_COLORS[0]!.hex);
    expect(nextGroupColor([GROUP_COLORS[0]!.hex, GROUP_COLORS[1]!.hex])).toBe(GROUP_COLORS[2]!.hex);
    expect(nextGroupColor(GROUP_COLORS.map((c) => c.hex))).toBe(GROUP_COLORS[0]!.hex);
  });
});
