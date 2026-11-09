import { WORKSPACE_ICON_PREFIX, workspaceIconKey } from '@atrium/shared';
import { WORKSPACE_ICON_GROUPS, WORKSPACE_ICONS, type WorkspaceIconDef } from './icons.generated';

export { WORKSPACE_ICON_GROUPS, WORKSPACE_ICONS, type WorkspaceIconDef };

const BY_KEY = new Map<string, WorkspaceIconDef>(WORKSPACE_ICONS.map((icon) => [icon.key, icon]));

/** The curated icon behind a stored `mi:<key>` value, or `undefined` for letters, emoji and unknown keys. */
export function findWorkspaceIcon(icon: string): WorkspaceIconDef | undefined {
  const key = workspaceIconKey(icon);
  return key ? BY_KEY.get(key) : undefined;
}

/** True for any `mi:` value, valid or not (the tile then falls back to a letter instead of printing it). */
export const isIconKeyValue = (icon: string): boolean => icon.startsWith(WORKSPACE_ICON_PREFIX);

export const toStoredIcon = (key: string): string => `${WORKSPACE_ICON_PREFIX}${key}`;

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
