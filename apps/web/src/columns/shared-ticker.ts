import { useSyncExternalStore } from 'react';

const TICK_INTERVAL_MS = 30_000;

let currentNow = Date.now();
let timerId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  currentNow = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && timerId === null) {
    currentNow = Date.now();
    timerId = setInterval(notify, TICK_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };
}

function getSnapshot(): number {
  return currentNow;
}

/**
 * Shared 30-second ticker hook for live time displays (`world_clock`, `time_tracking`).
 * Uses a single module-level `setInterval` shared across all mounted cells, and cleans it up
 * when the last subscriber unmounts.
 */
export function useSharedTicker(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test helper to force-advance or reset the shared ticker snapshot. */
export function __notifySharedTickerForTests(timestamp: number = Date.now()): void {
  currentNow = timestamp;
  for (const listener of listeners) {
    listener();
  }
}
