import { z } from 'zod';
import { ApiError } from '../errors';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** `?group=&cursor=&limit=`: `limit` defaults to 50 and is cut to 200. */
export const pageQuery = z.object({
  group: z.string().min(1).max(200).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .transform((value) => Math.min(value ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)),
});

/** The cursor is opaque to callers: a versioned, base64url-encoded offset. */
export const encodeCursor = (offset: number): string =>
  Buffer.from(JSON.stringify({ v: 1, o: offset })).toString('base64url');

export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown;
      o?: unknown;
    };
    if (parsed.v === 1 && Number.isSafeInteger(parsed.o) && (parsed.o as number) >= 0) {
      return parsed.o as number;
    }
  } catch {
    // fall through
  }
  throw new ApiError(400, 'invalid', 'cursor: not a cursor returned by this API.');
}
