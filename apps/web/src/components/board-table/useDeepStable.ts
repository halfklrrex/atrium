import { useState } from 'react';

/**
 * Returns the previous object while the new value is structurally equal to it. Firestore hands out
 * fresh arrays on every board snapshot; this keeps what is derived from them (and the memoised rows
 * that depend on it) from re-rendering when nothing really changed.
 */
export function useDeepStable<T>(value: T): T {
  const json = JSON.stringify(value);
  const [state, setState] = useState({ json, value });
  if (state.json !== json) {
    // Adjusting state while rendering: React re-renders straight away with the new value.
    setState({ json, value });
    return value;
  }
  return state.value;
}
