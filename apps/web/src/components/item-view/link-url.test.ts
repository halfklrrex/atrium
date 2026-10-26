import { describe, expect, it } from 'vitest';
import { parseLinkUrl } from './link-url';

describe('parseLinkUrl', () => {
  it('accepts http and https and adds https to a bare domain', () => {
    expect(parseLinkUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(parseLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(parseLinkUrl('example.com')).toBe('https://example.com/');
  });

  it('refuses other schemes and empty input', () => {
    expect(parseLinkUrl('javascript:alert(1)')).toBeNull();
    expect(parseLinkUrl('mailto:a@b.co')).toBeNull();
    expect(parseLinkUrl('   ')).toBeNull();
  });
});
