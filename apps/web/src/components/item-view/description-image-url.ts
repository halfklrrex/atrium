import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { descriptionImageCalls, docImageCalls } from '../../lib/callables';

interface Entry {
  url: string;
  /** Epoch milliseconds, from the callable. */
  expiresAt: number;
}

/** A cached URL is reused until this long before it expires. */
export const URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_TIMER_MS = 2_000_000_000;

/** Where an image lives: an item's description, or a workspace doc. */
export interface ItemImageContext {
  boardId: string;
  itemId: string;
}
export interface DocImageContext {
  docId: string;
}
export type ImageContext = ItemImageContext | DocImageContext;

export const isDocImageContext = (ctx: ImageContext): ctx is DocImageContext => 'docId' in ctx;

/** A stable string for a scope (used for cache keys and hook dependencies). */
export const imageScopeKey = (ctx: ImageContext): string =>
  isDocImageContext(ctx) ? `doc:${ctx.docId}` : `${ctx.boardId}/${ctx.itemId}`;

/** The scope an image extension was configured with (doc images win when `docId` is set). */
export function imageContextOf(options: {
  boardId?: string;
  itemId?: string;
  docId?: string;
}): ImageContext {
  return options.docId
    ? { docId: options.docId }
    : { boardId: options.boardId ?? '', itemId: options.itemId ?? '' };
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const keyOf = (ctx: ImageContext, fileId: string) => `${imageScopeKey(ctx)}/${fileId}`;

const isFresh = (entry: Entry | undefined): entry is Entry =>
  Boolean(entry && entry.expiresAt - Date.now() > URL_REFRESH_MARGIN_MS);

/** The signed URL for a description or doc image: cached per fileId, shared by concurrent callers. */
export function resolveImageUrl(ctx: ImageContext, fileId: string, force = false): Promise<Entry> {
  const key = keyOf(ctx, fileId);
  const cached = cache.get(key);
  if (!force && isFresh(cached)) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const fetchUrl = isDocImageContext(ctx)
    ? docImageCalls.getUrl({ docId: ctx.docId, fileId })
    : descriptionImageCalls.getUrl({ boardId: ctx.boardId, itemId: ctx.itemId, fileId });
  const request = fetchUrl
    .then((result) => {
      const entry = { url: result.url, expiresAt: result.expiresAt };
      cache.set(key, entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/**
 * Shows a just-uploaded image from its local preview URL until the signed one is fetched: the node
 * view finds a fresh entry and skips the getUrl round trip. The hook swaps to the signed URL when
 * this entry nears its expiry.
 */
export function seedImageUrl(
  ctx: ImageContext,
  fileId: string,
  url: string,
  lifetimeMs: number,
): void {
  cache.set(keyOf(ctx, fileId), { url, expiresAt: Date.now() + lifetimeMs });
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
  const ctx = useMemo<ImageContext>(() => ({ boardId, itemId }), [boardId, itemId]);
  return useImageUrl(ctx, fileId);
}

/** The same for either scope; `ctx` should be stable (memoized) between renders. */
export function useImageUrl(ctx: ImageContext, fileId: string) {
  const [state, setState] = useState<DescriptionImageUrlState>(() => {
    const cached = cache.get(keyOf(ctx, fileId));
    return isFresh(cached) ? { status: 'ready', url: cached.url } : { status: 'loading' };
  });
  const retried = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const load = useCallback(
    (force: boolean) => {
      const attempt = (forced: boolean, quiet = false): void => {
        resolveImageUrl(ctx, fileId, forced).then(
          (entry) => {
            if (!alive.current) return;
            setState({ status: 'ready', url: entry.url });
            if (timer.current) clearTimeout(timer.current);
            const wait = Math.min(
              Math.max(entry.expiresAt - Date.now() - URL_REFRESH_MARGIN_MS, 1000),
              MAX_TIMER_MS,
            );
            timer.current = setTimeout(() => attempt(true, true), wait);
          },
          () => {
            // A failed background refresh keeps the current URL; its onError decides later.
            if (alive.current && !quiet) setState({ status: 'unavailable' });
          },
        );
      };
      attempt(force);
    },
    [ctx, fileId],
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
    cache.delete(keyOf(ctx, fileId));
    load(true);
  }, [ctx, fileId, load]);

  return { ...state, onError };
}
