import { useEffect, useState } from 'react';

/**
 * The current time in milliseconds, refreshed every `intervalMs` while `enabled` (a render must not
 * call `Date.now()` itself). Used to tell a stale type change from a fresh one.
 */
export function useNow(enabled: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}
