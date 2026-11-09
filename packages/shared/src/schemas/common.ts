import { z } from 'zod';

/**
 * Structural stand-in for a Firestore `Timestamp`. Both the web SDK and the Admin SDK satisfy it, which
 * keeps this package free of any Firebase dependency.
 */
export interface TimestampLike {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

/** Opaque sentinel such as `serverTimestamp()` - what clients and functions write for timestamp fields. */
export interface ServerTimestampSentinel {
  isEqual(other: never): boolean;
}

/** Document shape for writes: timestamp fields accept a server-timestamp sentinel. */
export type WriteDoc<T> = {
  [K in keyof T]: T[K] extends TimestampLike ? TimestampLike | ServerTimestampSentinel : T[K];
};

export const timestampSchema = z.custom<TimestampLike>(
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { toDate?: unknown }).toDate === 'function' &&
    typeof (v as { toMillis?: unknown }).toMillis === 'function',
  { message: 'Expected a Firestore timestamp' },
);

export const uidSchema = z.string().min(1).max(128);
export const idSchema = z.string().min(1).max(128);

/** `#RRGGBB` hex colour. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB colour');

/** Emoji or short letter used as an avatar. */
export const iconSchema = z.string().min(1).max(8);

/** Prefix of a legacy stored Material Symbols icon key: `mi:<key>` (stays valid and readable). */
export const WORKSPACE_ICON_PREFIX = 'mi:';
/** Prefix of a stored Phosphor icon key: `ph:<key>` (what the app writes from now on). */
export const PHOSPHOR_ICON_PREFIX = 'ph:';
/** An icon name as stored after the prefix, e.g. `home`, `diversity_3`, `rocket-launch`. */
export const WORKSPACE_ICON_KEY_PATTERN = /^[a-z0-9_-]{1,40}$/;

/**
 * Workspace or folder icon: a letter or emoji (1 to 8 characters), `ph:<key>` (Phosphor) or the
 * legacy `mi:<key>` (Material Symbols), at most 48 characters in all. Mirrors `validWorkspaceIcon`
 * in firestore.rules.
 */
export const workspaceIconSchema = z
  .string()
  .min(1)
  .max(48)
  .refine(
    (value) => {
      for (const prefix of [PHOSPHOR_ICON_PREFIX, WORKSPACE_ICON_PREFIX]) {
        if (value.startsWith(prefix)) {
          return WORKSPACE_ICON_KEY_PATTERN.test(value.slice(prefix.length));
        }
      }
      return value.length <= 8;
    },
    { message: 'Expected a letter, an emoji or a ph:<icon> key' },
  );

/** A stored icon split into its prefix and key. */
export interface ParsedIconKey {
  prefix: 'ph' | 'mi';
  key: string;
}

/** The prefix and key of a stored `ph:` or `mi:` icon, or `null` for a letter, emoji or bad key. */
export function parseWorkspaceIcon(icon: string): ParsedIconKey | null {
  for (const [prefix, text] of [
    ['ph', PHOSPHOR_ICON_PREFIX],
    ['mi', WORKSPACE_ICON_PREFIX],
  ] as const) {
    if (icon.startsWith(text)) {
      const key = icon.slice(text.length);
      return WORKSPACE_ICON_KEY_PATTERN.test(key) ? { prefix, key } : null;
    }
  }
  return null;
}

/**
 * The key of a legacy `mi:` icon, or `null` for anything else (letters, emoji and `ph:` icons).
 * Use `parseWorkspaceIcon` to read either prefix.
 */
export function workspaceIconKey(icon: string): string | null {
  const parsed = parseWorkspaceIcon(icon);
  return parsed?.prefix === 'mi' ? parsed.key : null;
}

/** Fractional-indexing key used for ordering (architecture §4). */
export const positionSchema = z.string().min(1).max(64);

/** Create/update metadata present on every user-editable document. */
export const auditFields = {
  createdAt: timestampSchema,
  createdBy: uidSchema,
  updatedAt: timestampSchema,
};
