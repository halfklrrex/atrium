import { describe, expect, it } from 'vitest';
import { WORKSPACE_ICON_KEY_PATTERN } from '@atrium/shared';
import generatedSource from './icons.generated.ts?raw';
import {
  findWorkspaceIcon,
  searchWorkspaceIcons,
  toStoredIcon,
  WORKSPACE_ICON_GROUPS,
  WORKSPACE_ICONS,
} from './icons';
import { LEGACY_MATERIAL_ICONS } from './legacy-material';

/** The 161 keys of the first (Material Symbols) icon set, as shipped on 2026-11-09. */
const LEGACY_KEYS =
  'home cottage apartment villa family_home bed chair_alt weekend diversity_3 groups person group child_care cake handshake celebration elderly work business_center payments account_balance savings credit_card receipt_long trending_up bar_chart pie_chart analytics store storefront campaign inventory_2 corporate_fare badge contract work_history school menu_book auto_stories science calculate language history_edu draw edit_note psychology local_library quiz favorite monitor_heart ecg_heart cardiology medical_services healing fitness_center spa self_improvement restaurant lunch_dining local_cafe bakery_dining local_pizza icecream nutrition flight directions_car directions_bus train directions_bike sailing luggage hotel map explore beach_access camping hiking local_taxi two_wheeler commute public park forest eco potted_plant yard grass local_florist pets cruelty_free flutter_dash water_drop air sunny nightlight cloud ac_unit build construction handyman hardware code terminal computer laptop_mac call devices router memory bolt settings engineering electrical_services plumbing cleaning_services sports_esports sports_soccer sports_basketball sports_tennis palette brush music_note headphones piano theater_comedy movie photo_camera videocam casino extension toys sports_bar star rocket_launch lightbulb flag bookmark diamond trophy verified shield lock key target schedule calendar_month folder event task_alt checklist dashboard view_kanban inbox mail chat forum notifications shopping_cart shopping_bag sell redeem'.split(
    ' ',
  );

describe('workspace icon set', () => {
  it('has unique, well-formed keys, known groups and both weights of path data', () => {
    const keys = WORKSPACE_ICONS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = new Set(WORKSPACE_ICON_GROUPS.map((g) => g.id));
    for (const icon of WORKSPACE_ICONS) {
      expect(icon.key).toMatch(WORKSPACE_ICON_KEY_PATTERN);
      expect(groups.has(icon.group)).toBe(true);
      expect(icon.regular.length).toBeGreaterThan(10);
      expect(icon.fill.length).toBeGreaterThan(10);
      expect(icon.fill).not.toBe(icon.regular);
    }
    for (const group of WORKSPACE_ICON_GROUPS) {
      expect(WORKSPACE_ICONS.some((i) => i.group === group.id)).toBe(true);
    }
    expect(WORKSPACE_ICONS.length).toBeGreaterThanOrEqual(190);
    expect(WORKSPACE_ICONS.length).toBeLessThanOrEqual(210);
  });

  it('stays small and does not use the misleading preview picks', () => {
    expect(generatedSource.length).toBeLessThan(260 * 1024);
    const keys = new Set(WORKSPACE_ICONS.map((i) => i.key));
    for (const key of [
      'house',
      'users-three',
      'briefcase',
      'rocket-launch',
      'fork-knife',
      'wrench',
      'globe-hemisphere-west',
      'heartbeat',
      'folder-simple',
    ]) {
      expect(keys.has(key)).toBe(true);
    }
    expect(findWorkspaceIcon('mi:family_restroom')).toBeUndefined();
    expect(findWorkspaceIcon('mi:health_and_safety')).toBeUndefined();
  });

  it('looks up stored ph: values and resolves legacy mi: values through the map', () => {
    expect(findWorkspaceIcon('ph:rocket-launch')?.key).toBe('rocket-launch');
    expect(findWorkspaceIcon('mi:home')?.key).toBe('house');
    expect(findWorkspaceIcon('mi:diversity_3')?.key).toBe('users-three');
    expect(findWorkspaceIcon('ph:nope')).toBeUndefined();
    expect(findWorkspaceIcon('mi:nope')).toBeUndefined();
    expect(findWorkspaceIcon('A')).toBeUndefined();
    expect(toStoredIcon('rocket-launch')).toBe('ph:rocket-launch');
  });

  it('maps every legacy Material key to an icon in the curated set', () => {
    expect(LEGACY_KEYS).toHaveLength(161);
    const keys = new Set(WORKSPACE_ICONS.map((i) => i.key));
    for (const legacy of LEGACY_KEYS) {
      const target = LEGACY_MATERIAL_ICONS[legacy];
      expect(target, `unmapped legacy key ${legacy}`).toBeDefined();
      expect(keys.has(target!), `${legacy} maps to missing ${target}`).toBe(true);
      expect(findWorkspaceIcon(`mi:${legacy}`)?.key).toBe(target);
    }
    expect(Object.keys(LEGACY_MATERIAL_ICONS).sort()).toEqual([...LEGACY_KEYS].sort());
  });

  it('finds the heartbeat icon by health, ecg and heartbeat, and keeps heart as the plain heart', () => {
    for (const query of ['health', 'ecg', 'heartbeat']) {
      expect(searchWorkspaceIcons(query).map((i) => i.key)).toContain('heartbeat');
    }
    expect(searchWorkspaceIcons('health').map((i) => i.key)).not.toContain('heart');
    expect(searchWorkspaceIcons('heart').map((i) => i.key)).toContain('heart');
  });

  it('searches label and keywords', () => {
    expect(searchWorkspaceIcons('')).toHaveLength(WORKSPACE_ICONS.length);
    expect(searchWorkspaceIcons('family').map((i) => i.key)).toContain('users-three');
    expect(searchWorkspaceIcons('  ROCKET ').map((i) => i.key)).toContain('rocket-launch');
    expect(searchWorkspaceIcons('zzzzzz')).toHaveLength(0);
  });
});
