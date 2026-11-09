import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lower-cases and joins words with dashes', () => {
    expect(slugify('Q4 Roadmap', 'board')).toBe('q4-roadmap');
    expect(slugify('Sprint 12', 'board')).toBe('sprint-12');
  });
  it('folds accents', () => {
    expect(slugify('Café Crème Brûlée', 'board')).toBe('cafe-creme-brulee');
  });
  it('collapses punctuation and trims leading/trailing symbols', () => {
    expect(slugify('  --Hello,   World!!  ', 'board')).toBe('hello-world');
    expect(slugify('***', 'board')).toBe('board');
  });
  it('falls back for emoji-only and non-Latin names', () => {
    expect(slugify('🚀🔥', 'workspace')).toBe('workspace');
    expect(slugify('日本語', 'dashboard')).toBe('dashboard');
    expect(slugify('', 'board')).toBe('board');
  });
  it('keeps the Latin part of mixed names', () => {
    expect(slugify('Plan 🚀 2027', 'board')).toBe('plan-2027');
  });
  it('caps at 40 characters, cutting at a dash when possible', () => {
    const long = 'a very long board name that keeps going and going forever';
    const slug = slugify(long, 'board');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe('a-very-long-board-name-that-keeps-going');
    expect(slugify('x'.repeat(100), 'board')).toBe('x'.repeat(40));
  });
});
