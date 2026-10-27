import { useCallback, useEffect, useRef, useState } from 'react';
import { descriptionImageCalls } from '../../lib/callables';

interface Entry {
  url: string;
  /** Epoch milliseconds, from the callable. */
  expiresAt: number;
}

/** A cached URL is reused until this long before it expires. */
export const URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_TIMER_MS = 2_000_000_000;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const keyOf = (boardId: string, itemId: string, fileId: string) => `${boardId}/${itemId}/${fileId}`;

const isFresh = (entry: Entry | undefined): entry is Entry =>
  Boolean(entry && entry.expiresAt - Date.now() > URL_REFRESH_MARGIN_MS);

/** The signed URL for a description image: cached per fileId, shared by concurrent callers. */
export function resolveDescriptionImageUrl(
  boardId: string,
  itemId: string,
  fileId: string,
  force = false,
): Promise<Entry> {
  const key = keyOf(boardId, itemId, fileId);
  const cached = cache.get(key);
  if (!force && isFresh(cached)) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = descriptionImageCalls
    .getUrl({ boardId, itemId, fileId })
    .then((result) => {
      const entry = { url: result.url, expiresAt: result.expiresAt };
      cache.set(key, entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Test helper: forget every cached URL. */
export function clearDescriptionImageUrlCache(): void {
  cache.clear();
  inflight.clear();
}

export type DescriptionImageUrlState =
  { status: 'loading' } | { status: 'ready'; url: string } | { status: 'unavailable' };

/**
 * Resolves a description image to a displayable URL. It refreshes shortly before the URL expires,
 * and once when the image fails to load (an expired or revoked URL); a second failure means the
 * image is unavailable.
 */
export function useDescriptionImageUrl(boardId: string, itemId: string, fileId: string) {
  const [state, setState] = useState<DescriptionImageUrlState>(() => {
    const cached = cache.get(keyOf(boardId, itemId, fileId));
    return isFresh(cached) ? { status: 'ready', url: cached.url } : { status: 'loading' };
  });
  const retried = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const load = useCallback(
    (force: boolean) => {
      const attempt = (forced: boolean): void => {
        resolveDescriptionImageUrl(boardId, itemId, fileId, forced).then(
          (entry) => {
            if (!alive.current) return;
            setState({ status: 'ready', url: entry.url });
            if (timer.current) clearTimeout(timer.current);
            const wait = Math.min(
              Math.max(entry.expiresAt - Date.now() - URL_REFRESH_MARGIN_MS, 1000),
              MAX_TIMER_MS,
            );
            timer.current = setTimeout(() => attempt(true), wait);
          },
          () => {
            if (alive.current) setState({ status: 'unavailable' });
          },
        );
      };
      attempt(force);
    },
    [boardId, itemId, fileId],
  );

  useEffect(() => {
    alive.current = true;
    retried.current = false;
    load(false);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  /** Wire to the image's `onError`. */
  const onError = useCallback(() => {
    if (retried.current) {
      setState({ status: 'unavailable' });
      return;
    }
    retried.current = true;
    cache.delete(keyOf(boardId, itemId, fileId));
    load(true);
  }, [boardId, itemId, fileId, load]);

  return { ...state, onError };
}
