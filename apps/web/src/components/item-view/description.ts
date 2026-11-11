import {
  buildDescription,
  docToText,
  isEmptyDoc,
  stripTransientNodes,
  type DescriptionResult,
  type DescriptionValue,
} from '@atrium/shared';

// The pure doc helpers live in @atrium/shared (also used by the MCP scripts); re-exported here.
export { buildDescription, docToText, isEmptyDoc, stripTransientNodes };
export type { DescriptionResult, DescriptionValue };

/**
 * A trailing debouncer: `schedule(fn)` runs the LAST scheduled function after `ms` of quiet;
 * `flush()` runs it now; `cancel()` drops it.
 */
export function createDebouncer(ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const fn = pending;
    pending = null;
    fn?.();
  };
  return {
    schedule(fn: () => void) {
      pending = fn;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    },
    flush: run,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    hasPending: () => pending !== null,
  };
}

export const DESCRIPTION_SAVE_DELAY = 800;
