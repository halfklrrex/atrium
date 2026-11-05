import type { PublicFormQuestion } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { checkAnswers, collectAnswers, toAnswer } from './form-answers';

const pq = (
  columnId: string,
  type: string,
  required = false,
  settings: Record<string, unknown> = {},
): PublicFormQuestion => ({ columnId, label: columnId, required, type, settings });

describe('form answers', () => {
  it.each([
    ['name', '  Avery  ', 'Avery'],
    ['text', 'hi', 'hi'],
    ['long_text', 'story', { text: 'story' }],
    ['numbers', '12.5', 12.5],
    ['status', 1, { index: 1 }],
    ['dropdown', [1, 2], { ids: [1, 2] }],
    ['date', '2026-11-05', { date: '2026-11-05' }],
    ['checkbox', true, { checked: true }],
    ['email', 'avery@example.com', { email: 'avery@example.com' }],
    ['phone', '+1 555 0100', { phone: '+1 555 0100' }],
    ['link', 'https://example.com', { url: 'https://example.com' }],
    ['rating', 3, { rating: 3 }],
  ])('turns a %s draft into the cell value', (type, draft, expected) => {
    expect(toAnswer(pq('c', type), draft)).toEqual(expected);
  });

  it('leaves empty drafts out', () => {
    for (const [type, draft] of [
      ['text', '  '],
      ['status', null],
      ['dropdown', []],
      ['checkbox', false],
      ['rating', 0],
    ] as const) {
      expect(toAnswer(pq('c', type), draft)).toBeUndefined();
    }
    expect(collectAnswers([pq('name', 'name'), pq('a', 'text')], { name: 'x', a: '' })).toEqual({
      name: 'x',
    });
  });

  it('checks required, number, email and link answers', () => {
    const questions = [
      pq('name', 'name', true),
      pq('n', 'numbers'),
      pq('e', 'email'),
      pq('l', 'link'),
    ];
    expect(checkAnswers(questions, { n: 'abc', e: 'nope', l: 'example.com' })).toEqual({
      name: 'This question is required.',
      n: 'Enter a number.',
      e: 'Enter a valid email address.',
      l: 'Enter a link starting with https://',
    });
    expect(
      checkAnswers(questions, { name: 'A', n: '4', e: 'a@example.com', l: 'https://example.com' }),
    ).toEqual({});
  });
});
