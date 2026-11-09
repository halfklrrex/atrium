import { parseWorkspaceIcon, PHOSPHOR_ICON_PREFIX, WORKSPACE_ICON_PREFIX } from '@atrium/shared';
import { LEGACY_MATERIAL_ICONS } from './legacy-material';
import { WORKSPACE_ICON_GROUPS, WORKSPACE_ICONS, type WorkspaceIconDef } from './icons.generated';

export { WORKSPACE_ICON_GROUPS, WORKSPACE_ICONS, type WorkspaceIconDef };

const BY_KEY = new Map<string, WorkspaceIconDef>(WORKSPACE_ICONS.map((icon) => [icon.key, icon]));

/**
 * The curated icon behind a stored `ph:<key>` value, or behind a legacy `mi:<key>` value through
 * the hand-reviewed map. `undefined` for letters, emoji and unknown keys.
 */
export function findWorkspaceIcon(icon: string): WorkspaceIconDef | undefined {
  const parsed = parseWorkspaceIcon(icon);
  if (!parsed) return undefined;
  return BY_KEY.get(
    parsed.prefix === 'mi' ? (LEGACY_MATERIAL_ICONS[parsed.key] ?? '') : parsed.key,
  );
}

/** True for any `ph:` or `mi:` value, valid or not (the tile then falls back to a letter instead of printing it). */
export const isIconKeyValue = (icon: string): boolean =>
  icon.startsWith(PHOSPHOR_ICON_PREFIX) || icon.startsWith(WORKSPACE_ICON_PREFIX);

/** The value stored for a picked icon. The app always writes `ph:`; `mi:` is only read. */
export const toStoredIcon = (key: string): string => `${PHOSPHOR_ICON_PREFIX}${key}`;

const normalise = (text: string): string => text.toLowerCase().trim();

/** Icons whose label or keywords contain every word of the query. An empty query returns all. */
export function searchWorkspaceIcons(query: string): readonly WorkspaceIconDef[] {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (!words.length) return WORKSPACE_ICONS;
  return WORKSPACE_ICONS.filter((icon) => {
    const haystack = `${icon.label} ${icon.keywords}`;
    return words.every((word) => haystack.includes(word));
  });
}
