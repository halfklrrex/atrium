import { describe, expect, it } from 'vitest';
import {
  ITEM_INDEX_LIMITS,
  assigneeUidsOf,
  itemIndexFields,
  nameTokensOf,
  searchWordsOf,
} from './item-index';

describe('nameTokensOf', () => {
  it('emits every prefix of 2 to 15 characters of each word', () => {
    expect(nameTokensOf('Plan Q3')).toEqual(['pl', 'pla', 'plan', 'q3']);
  });

  it('lowercases and strips diacritics', () => {
    expect(nameTokensOf('Café Ñandú')).toEqual(['ca', 'caf', 'cafe', 'na', 'nan', 'nand', 'nandu']);
  });

  it('splits on punctuation and keeps digits', () => {
    expect(nameTokensOf('v2.10-beta_(final)!')).toEqual([
      'v2',
      '10',
      'be',
      'bet',
      'beta',
      'fi',
      'fin',
      'fina',
      'final',
    ]);
  });

  it('ignores emoji and single characters', () => {
    expect(nameTokensOf('🚀 a b launch 🎉')).toEqual(['la', 'lau', 'laun', 'launc', 'launch']);
    expect(nameTokensOf('🚀🎉')).toEqual([]);
  });

  it('is unique and caps a word at 15 characters', () => {
    const tokens = nameTokensOf('abc abc ' + 'x'.repeat(40));
    expect(tokens.filter((t) => t === 'ab')).toHaveLength(1);
    expect(tokens).toContain('x'.repeat(15));
    expect(tokens).not.toContain('x'.repeat(16));
  });

  it('caps very long names at 100 tokens', () => {
    const name = Array.from({ length: 60 }, (_, i) => `word${i}abcdefghijkl`).join(' ');
    const tokens = nameTokensOf(name);
    expect(tokens).toHaveLength(ITEM_INDEX_LIMITS.maxTokens);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('returns an empty list for a non-string name', () => {
    expect(nameTokensOf(undefined)).toEqual([]);
    expect(nameTokensOf(42)).toEqual([]);
  });
});

describe('searchWordsOf', () => {
  it('returns the longest word first, keeping the order of equal lengths', () => {
    expect(searchWordsOf('the quarterly plan now')).toEqual(['quarterly', 'plan', 'the', 'now']);
  });

  it('normalises like the tokens and cuts each word to 15 characters', () => {
    expect(searchWordsOf('  Café, ' + 'z'.repeat(30))).toEqual(['z'.repeat(15), 'cafe']);
  });

  it('is empty for an empty or symbol-only term', () => {
    expect(searchWordsOf('')).toEqual([]);
    expect(searchWordsOf(' -- ')).toEqual([]);
  });

  it('produces a word that is one of the name tokens', () => {
    const [first] = searchWordsOf('Quarterly');
    expect(nameTokensOf('Quarterly review')).toContain(first);
    expect(nameTokensOf('Quarterly review')).toContain(searchWordsOf('Quar')[0]);
  });
});

const board = {
  columns: [
    { id: 'owner', type: 'people' },
    { id: 'reviewer', type: 'people' },
    { id: 'status', type: 'status' },
  ],
  subitemColumns: [{ id: 'sub_owner', type: 'people' }],
};

describe('assigneeUidsOf', () => {
  it('collects persons across People columns, sorted and unique', () => {
    const values = {
      owner: {
        personsAndTeams: [
          { id: 'u2', kind: 'person' },
          { id: 'u1', kind: 'person' },
        ],
      },
      reviewer: { personsAndTeams: [{ id: 'u2', kind: 'person' }] },
    };
    expect(assigneeUidsOf(board.columns, values)).toEqual(['u1', 'u2']);
  });

  it('ignores teams, invalid values, other column types and unknown columns', () => {
    const values = {
      owner: {
        personsAndTeams: [
          { id: 't1', kind: 'team' },
          { id: 'u1', kind: 'person' },
        ],
      },
      reviewer: { personsAndTeams: 'nope' },
      status: { personsAndTeams: [{ id: 'u9', kind: 'person' }] },
      gone: { personsAndTeams: [{ id: 'u8', kind: 'person' }] },
    };
    expect(assigneeUidsOf(board.columns, values)).toEqual(['u1']);
    expect(assigneeUidsOf(board.columns, undefined)).toEqual([]);
    expect(assigneeUidsOf(board.columns, null)).toEqual([]);
  });
});

describe('itemIndexFields', () => {
  const people = (id: string) => ({ personsAndTeams: [{ id, kind: 'person' }] });

  it('uses the board columns for items and the subitem columns for subitems', () => {
    const values = { owner: people('u1'), sub_owner: people('u2') };
    expect(itemIndexFields(board, { name: 'Task', values, parentItemId: null })).toEqual({
      assigneeUids: ['u1'],
      nameTokens: ['ta', 'tas', 'task'],
    });
    expect(itemIndexFields(board, { name: 'Sub', values, parentItemId: 'p1' })).toEqual({
      assigneeUids: ['u2'],
      nameTokens: ['su', 'sub'],
    });
  });

  it('copes with a board without subitem columns', () => {
    expect(
      itemIndexFields({ columns: board.columns }, { name: 'x', values: {}, parentItemId: 'p' }),
    ).toEqual({ assigneeUids: [], nameTokens: [] });
  });
});
