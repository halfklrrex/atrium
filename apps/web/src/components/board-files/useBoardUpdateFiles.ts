import type { UpdateFileEntry } from '@atrium/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { updateAttachmentCalls } from '../../lib/callables';

/** A window focus within this long of the last fetch doesn't fetch again. */
const FOCUS_REFETCH_MIN_MS = 10_000;

const IDLE: Omit<BoardUpdateFiles, 'refresh'> = {
  files: [],
  truncated: false,
  loading: false,
  error: false,
};

export interface BoardUpdateFiles {
  files: UpdateFileEntry[];
  /** The server stopped reading or returning files; some are missing. */
  truncated: boolean;
  loading: boolean;
  error: boolean;
  refresh: () => void;
}

/**
 * The files attached to a board's updates and replies. A snapshot from a read callable: fetched
 * when the view opens, on window focus and on `refresh()`. Does nothing while `enabled` is false.
 */
export function useBoardUpdateFiles(boardId: string, enabled: boolean): BoardUpdateFiles {
  const [state, setState] = useState<Omit<BoardUpdateFiles, 'refresh'>>({
    files: [],
    truncated: false,
    loading: enabled,
    error: false,
  });
  const latest = useRef(0);
  const lastFetch = useRef(0);

  /** Starts a fetch; state changes only when it settles, so it is safe to call from an effect. */
  const fetchNow = useCallback(() => {
    const id = ++latest.current;
    lastFetch.current = Date.now();
    updateAttachmentCalls
      .listForBoard({ boardId })
      .then((res) => {
        if (id === latest.current) {
          setState({ files: res.files, truncated: res.truncated, loading: false, error: false });
        }
      })
      .catch(() => {
        if (id === latest.current) setState((s) => ({ ...s, loading: false, error: true }));
      });
  }, [boardId]);

  /** The Refresh button: shows the busy state, then fetches. */
  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: false }));
    fetchNow();
  }, [fetchNow]);

  useEffect(() => {
    if (!enabled) return;
    fetchNow();
    const onFocus = () => {
      if (Date.now() - lastFetch.current >= FOCUS_REFETCH_MIN_MS) fetchNow();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      latest.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, fetchNow]);

  if (!enabled) return { ...IDLE, refresh };
  return { ...state, refresh };
}
