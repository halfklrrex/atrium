import { describe, expect, it } from 'vitest';
import { activeMentionQuery, applyMention, mentionIdsInText, splitMentions } from './mentions';

describe('activeMentionQuery', () => {
  it('finds the @ the caret is in', () => {
    expect(activeMentionQuery('Hi @Jor', 7)).toEqual({ start: 3, query: 'Jor' });
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('allows spaces in the query (names have them) but not line breaks', () => {
    expect(activeMentionQuery('Hi @Jordan L', 12)).toEqual({ start: 3, query: 'Jordan L' });
    expect(activeMentionQuery('Hi @Jordan\nLee', 14)).toBeNull();
  });

  it('ignores an @ inside a word, such as an email address', () => {
    expect(activeMentionQuery('mail avery@example', 18)).toBeNull();
  });

  it('is null when there is no @ before the caret or the query is long', () => {
    expect(activeMentionQuery('hello', 5)).toBeNull();
    expect(activeMentionQuery('@' + 'a'.repeat(40), 41)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces the query with "@Name " and puts the caret after it', () => {
    const next = applyMention('Hi @Jo please', { start: 3, query: 'Jo' }, 6, 'Jordan Lee');
    expect(next.text).toBe('Hi @Jordan Lee  please');
    expect(next.caret).toBe('Hi @Jordan Lee '.length);
  });
});

describe('mentionIdsInText', () => {
  const picked = [
    { uid: 'u2', name: 'Jordan Lee' },
    { uid: 'u3', name: 'Sam Rivera' },
  ];

  it('keeps the ids whose @Name is still in the text', () => {
    expect(mentionIdsInText('Hey @Jordan Lee and @Sam Rivera', picked)).toEqual(['u2', 'u3']);
  });

  it('drops an id when its @Name was deleted', () => {
    expect(mentionIdsInText('Hey @Jordan Lee', picked)).toEqual(['u2']);
    expect(mentionIdsInText('Hey Jordan Lee', picked)).toEqual([]);
  });

  it('lists an id once even when picked twice', () => {
    const twice = [...picked, { uid: 'u2', name: 'Jordan Lee' }];
    expect(mentionIdsInText('@Jordan Lee @Jordan Lee', twice)).toEqual(['u2']);
  });
});

describe('splitMentions', () => {
  it('marks each @Name of the given names', () => {
    expect(splitMentions('Hi @Jordan Lee, ok?', ['Jordan Lee'])).toEqual([
      { text: 'Hi ', mention: false },
      { text: '@Jordan Lee', mention: true },
      { text: ', ok?', mention: false },
    ]);
  });

  it('prefers the longest name and escapes regex characters', () => {
    const parts = splitMentions('@Sam R. and @Sam', ['Sam', 'Sam R.']);
    expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual(['@Sam R.', '@Sam']);
  });

  it('returns the text untouched without names', () => {
    expect(splitMentions('plain @text', [])).toEqual([{ text: 'plain @text', mention: false }]);
  });
});
