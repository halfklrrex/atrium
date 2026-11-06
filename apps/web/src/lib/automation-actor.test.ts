import { describe, expect, it } from 'vitest';
import { authorLabel, isAutomationActor } from './automation-actor';

describe('isAutomationActor', () => {
  it('matches prefixed ids only', () => {
    expect(isAutomationActor('automation:abc')).toBe(true);
    expect(isAutomationActor('u1')).toBe(false);
    expect(isAutomationActor('automation')).toBe(false);
    expect(isAutomationActor('')).toBe(false);
    expect(isAutomationActor(undefined)).toBe(false);
    expect(isAutomationActor(null)).toBe(false);
  });
});

describe('authorLabel', () => {
  it('names automations even with no stored name', () => {
    expect(authorLabel('automation:abc', undefined, 'u1')).toBe('Automations');
    expect(authorLabel('automation:abc', 'Something else', 'u1')).toBe('Automations');
  });
  it('falls back to the name, You, then Member', () => {
    expect(authorLabel('u2', 'Jordan Lee', 'u1')).toBe('Jordan Lee');
    expect(authorLabel('u1', undefined, 'u1')).toBe('You');
    expect(authorLabel('u2', undefined, 'u1')).toBe('Member');
  });
});
