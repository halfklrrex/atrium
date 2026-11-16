/** A signed download URL and when it stops working (epoch milliseconds). */
export interface SignedUrl {
  downloadUrl: string;
  expiresAt: number;
}

/** A cached URL is dropped this long before it expires. */
export const URL_EXPIRY_MARGIN_MS = 60_000;

/** The most thumbnail URL fetches that run at once. */
export const MAX_CONCURRENT_FETCHES = 4;

// Memory only: signed URLs never go to storage.
const cache = new Map<string, SignedUrl>();
const inFlight = new Map<string, Promise<SignedUrl>>();

/** A cached URL that is still good for at least the margin, or null. */
export function getCachedUrl(key: string, now: number = Date.now()): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt - URL_EXPIRY_MARGIN_MS <= now) {
    cache.delete(key);
    return null;
  }
  return hit.downloadUrl;
}

export function clearUrlCache(): void {
  cache.clear();
  inFlight.clear();
  queue.length = 0;
  running = 0;
}

type Job = () => void;
const queue: Job[] = [];
let running = 0;

function pump(): void {
  while (running < MAX_CONCURRENT_FETCHES && queue.length > 0) {
    const job = queue.shift();
    running += 1;
    job?.();
  }
}

/**
 * The URL for `key`: from the cache when fresh, else fetched through a queue that runs at most
 * `MAX_CONCURRENT_FETCHES` fetches at once. Callers asking for the same key share one fetch.
 */
export function resolveUrl(key: string, fetchUrl: () => Promise<SignedUrl>): Promise<string> {
  const cached = getCachedUrl(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending.then((r) => r.downloadUrl);
  const promise = new Promise<SignedUrl>((resolve, reject) => {
    queue.push(() => {
      fetchUrl().then(resolve, reject);
    });
    pump();
  });
  const done = () => {
    inFlight.delete(key);
    running -= 1;
    pump();
  };
  inFlight.set(key, promise);
  promise.then(
    (signed) => {
      cache.set(key, signed);
      done();
    },
    () => done(),
  );
  return promise.then((r) => r.downloadUrl);
}

/** The URL for opening a file: the cache when fresh, else a direct fetch (not queued). */
export async function resolveUrlNow(
  key: string,
  fetchUrl: () => Promise<SignedUrl>,
): Promise<string> {
  const cached = getCachedUrl(key);
  if (cached) return cached;
  const signed = await fetchUrl();
  cache.set(key, signed);
  return signed.downloadUrl;
}
