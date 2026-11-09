import { describe, expect, it } from 'vitest';
import { WORKSPACE_ICON_KEY_PATTERN } from '@atrium/shared';
import generatedSource from './icons.generated.ts?raw';
import {
  findWorkspaceIcon,
  searchWorkspaceIcons,
  WORKSPACE_ICON_GROUPS,
  WORKSPACE_ICONS,
} from './icons';

describe('workspace icon set', () => {
  it('has unique, well-formed keys, known groups and path data', () => {
    const keys = WORKSPACE_ICONS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = new Set(WORKSPACE_ICON_GROUPS.map((g) => g.id));
    for (const icon of WORKSPACE_ICONS) {
      expect(icon.key).toMatch(WORKSPACE_ICON_KEY_PATTERN);
      expect(groups.has(icon.group)).toBe(true);
      expect(icon.path.length).toBeGreaterThan(10);
    }
    expect(WORKSPACE_ICONS.length).toBeGreaterThanOrEqual(150);
    expect(WORKSPACE_ICONS.length).toBeLessThanOrEqual(200);
  });

  it('stays small and does not use the misleading preview picks', () => {
    expect(generatedSource.length).toBeLessThan(100 * 1024);
    const keys = new Set(WORKSPACE_ICONS.map((i) => i.key));
    expect(keys.has('family_restroom')).toBe(false);
    expect(keys.has('health_and_safety')).toBe(false);
    for (const key of [
      'home',
      'diversity_3',
      'work',
      'rocket_launch',
      'restaurant',
      'build',
      'public',
    ]) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it('looks up stored values', () => {
    expect(findWorkspaceIcon('mi:home')?.key).toBe('home');
    expect(findWorkspaceIcon('mi:nope')).toBeUndefined();
    expect(findWorkspaceIcon('A')).toBeUndefined();
  });

  it('searches label and keywords', () => {
    expect(searchWorkspaceIcons('')).toHaveLength(WORKSPACE_ICONS.length);
    expect(searchWorkspaceIcons('family').map((i) => i.key)).toContain('diversity_3');
    expect(searchWorkspaceIcons('  ROCKET ').map((i) => i.key)).toContain('rocket_launch');
    expect(searchWorkspaceIcons('zzzzzz')).toHaveLength(0);
  });
});
