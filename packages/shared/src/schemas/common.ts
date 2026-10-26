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

/** Fractional-indexing key used for ordering (architecture §4). */
export const positionSchema = z.string().min(1).max(64);

/** Create/update metadata present on every user-editable document. */
export const auditFields = {
  createdAt: timestampSchema,
  createdBy: uidSchema,
  updatedAt: timestampSchema,
};
