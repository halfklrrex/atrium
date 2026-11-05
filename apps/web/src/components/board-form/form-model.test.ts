import type { ColumnDef, FormQuestion } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  addableColumns,
  appendQuestion,
  formUrl,
  patchQuestion,
  removeQuestion,
  reorderQuestions,
} from './form-model';

const col = (
  id: string,
  type: string,
  position: string,
  extra: Partial<ColumnDef> = {},
): ColumnDef => ({
  id,
  type,
  title: id.toUpperCase(),
  position,
  settings: {},
  ...extra,
});

const q = (columnId: string, extra: Partial<FormQuestion> = {}): FormQuestion => ({
  columnId,
  label: columnId,
  required: false,
  ...extra,
});

const questions = [q('name', { required: true }), q('a'), q('b'), q('c')];

describe('form model', () => {
  it('builds the share link', () => {
    expect(formUrl('https://example.com', 'b1', 'v1')).toBe('https://example.com/forms/b1/v1');
  });

  it('offers only allowed, settled, unasked columns in board order', () => {
    const columns = [
      col('z', 'text', 'a2'),
      col('people', 'people', 'a0'),
      col('asked', 'numbers', 'a1'),
      col('moving', 'status', 'a3', { migrating: { toType: 'text' } as never }),
      col('d', 'date', 'a4'),
    ];
    expect(addableColumns(columns, [q('name'), q('asked')]).map((c) => c.id)).toEqual(['z', 'd']);
  });

  it('adds a question named after the column, optional by default', () => {
    expect(appendQuestion([q('name')], { id: 'x', title: 'Budget' }).at(-1)).toEqual({
      columnId: 'x',
      label: 'Budget',
      required: false,
    });
  });

  it('never removes the item name', () => {
    expect(removeQuestion(questions, 'name')).toHaveLength(4);
    expect(removeQuestion(questions, 'b').map((x) => x.columnId)).toEqual(['name', 'a', 'c']);
  });

  it('patches a question, dropping empty help and keeping the name required', () => {
    const withHelp = patchQuestion(questions, 'a', { help: 'Why', required: true });
    expect(withHelp[1]).toEqual({ columnId: 'a', label: 'a', required: true, help: 'Why' });
    expect(patchQuestion(withHelp, 'a', { help: '' })[1]).not.toHaveProperty('help');
    expect(patchQuestion(questions, 'name', { required: false })[0]!.required).toBe(true);
  });

  it('reorders but never above the name', () => {
    expect(reorderQuestions(questions, 'c', 'a').map((x) => x.columnId)).toEqual([
      'name',
      'c',
      'a',
      'b',
    ]);
    expect(reorderQuestions(questions, 'c', 'name').map((x) => x.columnId)).toEqual([
      'name',
      'a',
      'b',
      'c',
    ]);
    expect(reorderQuestions(questions, 'name', 'b')[0]!.columnId).toBe('name');
  });
});
