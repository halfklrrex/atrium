import { describe, expect, it } from 'vitest';
import { columnRegistry } from '../columns';
import { columnDefSchema, groupDefSchema } from '../schemas/board';
import {
  TEMPLATE_LIMITS,
  templateFromBoard,
  templateGroupsResolve,
  templateStructureSchema,
  templateSampleItemSchema,
  type TemplateSourceItem,
} from '../schemas/template';
import { BUILT_IN_TEMPLATES, builtInTemplate } from './built-in';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('built-in templates', () => {
  it('ships the five planned templates with unique ids', () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toEqual([
      'Project tracker',
      'Content calendar',
      'Bug tracker',
      'Family chores',
      'Reading list',
    ]);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(BUILT_IN_TEMPLATES.length);
    expect(builtInTemplate('bug-tracker')?.name).toBe('Bug tracker');
  });

  describe.each(BUILT_IN_TEMPLATES.map((t) => [t.name, t] as const))('%s', (_name, template) => {
    const { structure } = template;
    const columnsById = new Map(structure.columns.map((c) => [c.id, c]));

    it('has a valid structure with registered column types and valid settings', () => {
      expect(templateStructureSchema.safeParse(structure).success).toBe(true);
      for (const column of [...structure.columns, ...structure.subitemColumns]) {
        expect(columnDefSchema.safeParse(column).success).toBe(true);
        expect(columnRegistry.has(column.type)).toBe(true);
        expect(columnRegistry.parseSettings(column.type, column.settings).success).toBe(true);
      }
      for (const group of structure.groups) {
        expect(groupDefSchema.safeParse(group).success).toBe(true);
      }
      expect(new Set(structure.columns.map((c) => c.id)).size).toBe(structure.columns.length);
      expect(new Set(structure.groups.map((g) => g.id)).size).toBe(structure.groups.length);
    });

    it('has 4 to 8 sample items in groups the structure defines', () => {
      expect(template.sampleItems.length).toBeGreaterThanOrEqual(4);
      expect(template.sampleItems.length).toBeLessThanOrEqual(8);
      expect(templateGroupsResolve(template)).toBe(true);
      for (const item of template.sampleItems) {
        expect(templateSampleItemSchema.safeParse(item).success).toBe(true);
      }
    });

    it('has sample values that validate and none for derived or server-managed columns', () => {
      for (const item of template.sampleItems) {
        for (const [columnId, value] of Object.entries(item.values)) {
          const column = columnsById.get(columnId);
          expect(column, `${item.name}: unknown column ${columnId}`).toBeDefined();
          if (!column) continue;
          expect(columnRegistry.isDerived(column.type)).toBe(false);
          expect(columnRegistry.isServerManaged(column.type)).toBe(false);
          const result = columnRegistry.validateCell(column, value);
          expect(result.ok, `${item.name} / ${column.title}`).toBe(true);
        }
      }
    });
  });
});

describe('templateFromBoard', () => {
  const source = builtInTemplate('project-tracker')!;
  const board = {
    ...clone(source.structure),
    columns: [
      ...clone(source.structure.columns).map((c, i) =>
        i === 1
          ? {
              ...c,
              migrating: { snapshotId: 's1', startedAt: 1, kind: 'change' as const },
              lastTypeChange: { snapshotId: 's0', fromType: 'text', expiresAt: 5 },
            }
          : c,
      ),
      {
        id: 'rel',
        type: 'board_relation',
        title: 'Linked',
        position: 'a9',
        settings: { boardIds: ['other'], allowMultipleItems: true, twoWay: false },
      },
    ],
  };
  const item = (over: Partial<TemplateSourceItem>): TemplateSourceItem => ({
    name: 'Item',
    groupId: 'to_do',
    position: 'a0',
    parentItemId: null,
    state: 'active',
    values: {},
    ...over,
  });

  it('copies columns and groups, strips server fields and cross-board columns', () => {
    const result = templateFromBoard(board, [], { includeItems: false });
    expect(result.sampleItems).toEqual([]);
    expect(result.structure.groups).toEqual(source.structure.groups);
    expect(result.structure.columns.map((c) => c.id)).toEqual(
      source.structure.columns.map((c) => c.id),
    );
    expect(result.structure.columns[1]).toEqual(source.structure.columns[1]);
    expect(templateStructureSchema.safeParse(result.structure).success).toBe(true);
  });

  it('round-trips the built-in sample items', () => {
    const items = source.sampleItems.map((s, i) =>
      item({ ...s, position: `a${i}`, values: clone(s.values) }),
    );
    const result = templateFromBoard(board, items, { includeItems: true });
    expect(result.sampleItems.map((s) => s.name).sort()).toEqual(
      source.sampleItems.map((s) => s.name).sort(),
    );
    expect(result.sampleItems.find((s) => s.name === 'Draft the plan')?.values).toEqual(
      source.sampleItems.find((s) => s.name === 'Draft the plan')?.values,
    );
    expect(templateGroupsResolve(result)).toBe(true);
  });

  it('keeps only active top-level items, orders by group then position and caps at 50', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      item({ name: `n${i}`, groupId: 'in_progress', position: `a${String(i).padStart(2, '0')}` }),
    );
    const result = templateFromBoard(
      board,
      [
        ...many,
        item({ name: 'first', groupId: 'to_do' }),
        item({ name: 'archived', state: 'archived' }),
        item({ name: 'sub', parentItemId: 'p1' }),
        item({ name: 'lost', groupId: 'gone' }),
      ],
      { includeItems: true },
    );
    expect(result.sampleItems).toHaveLength(TEMPLATE_LIMITS.sampleItems);
    expect(result.sampleItems[0]?.name).toBe('first');
    expect(result.sampleItems[1]?.name).toBe('n0');
    expect(result.sampleItems.some((s) => ['archived', 'sub', 'lost'].includes(s.name))).toBe(
      false,
    );
  });

  it('drops people values, unknown columns and invalid values', () => {
    const result = templateFromBoard(
      board,
      [
        item({
          values: {
            owner: { personsAndTeams: [{ id: 'real-uid', kind: 'person' }] },
            status: { index: 1 },
            ghost: 'x',
            priority: { nope: true },
            rel: { linkedItems: [{ boardId: 'b', itemId: 'i' }] },
          },
        }),
      ],
      { includeItems: true },
    );
    expect(result.sampleItems[0]?.values).toEqual({ status: { index: 1 } });
  });
});
