import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ColumnDef } from '../schemas/board';
import {
  ColumnTypeRegistry,
  applyDefaultColumnValues,
  columnRegistry,
  defineColumnType,
  isColumnValueEmpty,
  validateColumnDef,
  validateRequiredColumns,
} from './index';

describe('P2 Column Validation & Defaults', () => {
  it('validates column definitions against the registry with validateColumnDef', () => {
    // Valid text column definition
    const validTextCol: ColumnDef = {
      id: 'col_text',
      type: 'text',
      title: 'Notes',
      position: '100',
      settings: {},
      defaultValue: 'Default note text',
    };
    expect(validateColumnDef(validTextCol, columnRegistry).valid).toBe(true);

    // Rejects unknown column type
    const unknownTypeCol: ColumnDef = {
      id: 'col_bad',
      type: 'quantum_entanglement',
      title: 'Unknown',
      position: '100',
      settings: {},
    };
    const unknownRes = validateColumnDef(unknownTypeCol, columnRegistry);
    expect(unknownRes.valid).toBe(false);
    expect(unknownRes).toHaveProperty('error', expect.stringContaining('Unknown column type'));

    // Rejects invalid settings for type
    const invalidSettingsCol: ColumnDef = {
      id: 'col_rating',
      type: 'rating',
      title: 'Rating',
      position: '100',
      settings: { max: 99 }, // rating allows 1-10
    };
    const invalidSettingsRes = validateColumnDef(invalidSettingsCol, columnRegistry);
    expect(invalidSettingsRes.valid).toBe(false);
    expect(invalidSettingsRes).toHaveProperty('error', expect.stringContaining('Invalid settings'));

    // Rejects default value for column type that cannot take one
    const testRegistryWithButton = new ColumnTypeRegistry().register(
      defineColumnType({
        type: 'button',
        label: 'Button',
        settingsSchema: z.object({ label: z.string(), color: z.string() }).strict(),
        valueSchema: z.object({}).strict(),
        defaultSettings: () => ({ label: 'Click', color: '#579bfc' }),
        toText: () => 'Click',
        compare: () => 0,
      }),
    );
    const buttonWithDefault: ColumnDef = {
      id: 'col_btn',
      type: 'button',
      title: 'Action',
      position: '100',
      settings: { label: 'Click', color: '#579bfc' },
      defaultValue: {},
    };
    const btnRes = validateColumnDef(buttonWithDefault, testRegistryWithButton);
    expect(btnRes.valid).toBe(false);
    expect(btnRes).toHaveProperty(
      'error',
      expect.stringContaining('does not support default values'),
    );

    const derivedWithDefault: ColumnDef = {
      id: 'col_progress',
      type: 'progress',
      title: 'Progress',
      position: '100',
      settings: {},
      defaultValue: 50,
    };
    const derivedRes = validateColumnDef(derivedWithDefault, columnRegistry);
    expect(derivedRes.valid).toBe(false);
    expect(derivedRes).toHaveProperty(
      'error',
      expect.stringContaining('does not support default values'),
    );

    // Rejects invalid default value conforming to type's valueSchema
    const invalidDefaultCol: ColumnDef = {
      id: 'col_num',
      type: 'numbers',
      title: 'Budget',
      position: '100',
      settings: {},
      defaultValue: 'not-a-number',
    };
    const invalidDefaultRes = validateColumnDef(invalidDefaultCol, columnRegistry);
    expect(invalidDefaultRes.valid).toBe(false);
    expect(invalidDefaultRes).toHaveProperty(
      'error',
      expect.stringContaining('Invalid default value'),
    );

    // Rejects default values exceeding size limit
    const oversizedDefaultCol: ColumnDef = {
      id: 'col_text_huge',
      type: 'text',
      title: 'Big Text',
      position: '100',
      settings: {},
      defaultValue: 'a'.repeat(15000), // > 10 KB
    };
    const oversizedRes = validateColumnDef(oversizedDefaultCol, columnRegistry);
    expect(oversizedRes.valid).toBe(false);
    expect(oversizedRes).toHaveProperty(
      'error',
      expect.stringContaining('exceeds maximum allowed size'),
    );
  });

  it('determines per-type emptiness correctly with isColumnValueEmpty', () => {
    // Basic primitives
    expect(isColumnValueEmpty('text', undefined)).toBe(true);
    expect(isColumnValueEmpty('text', null)).toBe(true);
    expect(isColumnValueEmpty('text', '')).toBe(true);
    expect(isColumnValueEmpty('text', '   ')).toBe(true);
    expect(isColumnValueEmpty('text', 'hello')).toBe(false);

    // Numeric and boolean values (0 and false are NOT empty)
    expect(isColumnValueEmpty('numbers', 0)).toBe(false);
    expect(isColumnValueEmpty('numbers', 42)).toBe(false);
    expect(isColumnValueEmpty('checkbox', false)).toBe(false);

    // Arrays
    expect(isColumnValueEmpty('tags', [])).toBe(true);
    expect(isColumnValueEmpty('tags', [1, 2])).toBe(false);

    // People column
    expect(isColumnValueEmpty('people', { personsAndTeams: [] })).toBe(true);
    expect(isColumnValueEmpty('people', { personsAndTeams: [{ id: 'u_1', kind: 'person' }] })).toBe(
      false,
    );

    // Files column
    expect(isColumnValueEmpty('files', { files: [] })).toBe(true);
    expect(
      isColumnValueEmpty('files', {
        files: [{ id: 'f1', name: 'a.png', size: 10, mimeType: 'image/png' }],
      }),
    ).toBe(false);

    // Dropdown and Tags
    expect(isColumnValueEmpty('dropdown', { ids: [] })).toBe(true);
    expect(isColumnValueEmpty('dropdown', { ids: [1] })).toBe(false);
    expect(isColumnValueEmpty('tags', { tag_ids: [] })).toBe(true);
    expect(isColumnValueEmpty('tags', { tag_ids: [10] })).toBe(false);

    // Dependency
    expect(isColumnValueEmpty('dependency', { item_ids: [] })).toBe(true);
    expect(isColumnValueEmpty('dependency', { item_ids: ['item_1'] })).toBe(false);

    // Status
    expect(isColumnValueEmpty('status', {})).toBe(true);
    expect(isColumnValueEmpty('status', { index: undefined, label: undefined })).toBe(true);
    expect(isColumnValueEmpty('status', { index: 0, label: 'Working on it' })).toBe(false);

    // Empty object
    expect(isColumnValueEmpty('custom', {})).toBe(true);
  });

  it('validates required columns with validateRequiredColumns', () => {
    const columns: ColumnDef[] = [
      {
        id: 'title',
        type: 'text',
        title: 'Task Name',
        position: '10',
        settings: {},
        required: true,
      },
      {
        id: 'assignee',
        type: 'people',
        title: 'Owner',
        position: '20',
        settings: {},
        required: true,
      },
      {
        id: 'score',
        type: 'numbers',
        title: 'Score',
        position: '30',
        settings: {},
        required: true,
      },
      { id: 'notes', type: 'text', title: 'Optional Note', position: '40', settings: {} }, // not required
    ];

    // Missing all required columns
    const emptyValues = {};
    const res1 = validateRequiredColumns(columns, emptyValues);
    expect(res1.valid).toBe(false);
    expect(res1.missingColumns).toEqual(['title', 'assignee', 'score']);

    // Empty personsAndTeams counts as missing
    const partialValues = {
      title: 'Launch rocket',
      assignee: { personsAndTeams: [] },
      score: 0, // 0 is a valid filled value!
    };
    const res2 = validateRequiredColumns(columns, partialValues);
    expect(res2.valid).toBe(false);
    expect(res2.missingColumns).toEqual(['assignee']);

    // All filled
    const allFilled = {
      title: 'Launch rocket',
      assignee: { personsAndTeams: [{ id: 'u_1', kind: 'person' }] },
      score: 0,
    };
    const res3 = validateRequiredColumns(columns, allFilled);
    expect(res3.valid).toBe(true);
    expect(res3.missingColumns).toHaveLength(0);
  });

  it('applies default column values with structuredClone isolation', () => {
    const defaultTagList = { tag_ids: [100, 200] };
    const columns: ColumnDef[] = [
      {
        id: 'col_status',
        type: 'status',
        title: 'Status',
        position: '10',
        settings: {},
        defaultValue: { index: 0, label: 'Working on it' },
      },
      {
        id: 'col_tags',
        type: 'tags',
        title: 'Tags',
        position: '20',
        settings: {},
        defaultValue: defaultTagList,
      },
      {
        id: 'col_text',
        type: 'text',
        title: 'Summary',
        position: '30',
        settings: {},
      },
    ];

    // Item with no values populated
    const initialValues = {};
    const applied = applyDefaultColumnValues(columns, initialValues);

    expect(applied['col_status']).toEqual({ index: 0, label: 'Working on it' });
    expect(applied['col_tags']).toEqual({ tag_ids: [100, 200] });
    expect(applied['col_text']).toBeUndefined();

    // Verifies structuredClone isolation: mutating applied value does not mutate column definition
    (applied['col_tags'] as { tag_ids: number[] }).tag_ids.push(300);
    expect(defaultTagList.tag_ids).toEqual([100, 200]);

    // Does not overwrite pre-existing values on the item
    const existing = { col_status: { index: 1, label: 'Done' } };
    const preserved = applyDefaultColumnValues(columns, existing);
    expect(preserved['col_status']).toEqual({ index: 1, label: 'Done' });
  });

  it('rejects a default value on any server-managed or derived type, flagged by the module', () => {
    const registry = new ColumnTypeRegistry()
      .register(
        defineColumnType({
          type: 'files_like',
          label: 'Files-like',
          serverManaged: true,
          settingsSchema: z.object({}).strict(),
          valueSchema: z.array(z.string()),
          defaultSettings: () => ({}),
          toText: (v) => v.join(','),
          compare: () => 0,
        }),
      )
      .register(
        defineColumnType({
          type: 'calc_like',
          label: 'Calc-like',
          derived: true,
          settingsSchema: z.object({}).strict(),
          valueSchema: z.string(),
          defaultSettings: () => ({}),
          toText: (v) => v,
          compare: () => 0,
          compute: () => 'x',
        }),
      );
    for (const [type, defaultValue] of [
      ['files_like', ['a']],
      ['calc_like', 'x'],
    ] as const) {
      const result = validateColumnDef(
        { id: 'c', type, title: 'C', position: '1', settings: {}, defaultValue },
        registry,
      );
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty(
        'error',
        expect.stringContaining('does not support default values'),
      );
    }
    // Without a default they are fine.
    expect(
      validateColumnDef(
        { id: 'c', type: 'files_like', title: 'C', position: '1', settings: {} },
        registry,
      ).valid,
    ).toBe(true);
  });
});
