import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';
import { useEffect, useState } from 'react';

export interface SnapshotState<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** What the last snapshot/error was delivered for, so a changed `source` reads as "loading again". */
interface Delivered<T> {
  source: unknown;
  data: T;
  error: Error | null;
}

const NO_DOCS: never[] = [];

/** Live query; `null` disables the subscription. Pass a referentially stable `query` (memoise it). */
export function useQuerySnapshot<T>(query: Query<T> | null): SnapshotState<T[]> {
  const [delivered, setDelivered] = useState<Delivered<T[]> | null>(null);

  useEffect(() => {
    if (!query) return;
    return onSnapshot(
      query,
      (snap) => setDelivered({ source: query, data: snap.docs.map((d) => d.data()), error: null }),
      (error) => setDelivered({ source: query, data: [], error }),
    );
  }, [query]);

  if (!query) return { data: NO_DOCS, loading: false, error: null };
  if (delivered?.source !== query) return { data: NO_DOCS, loading: true, error: null };
  return { data: delivered.data, loading: false, error: delivered.error };
}

/** Live document; `data` is `null` while missing. Pass a referentially stable `ref` (memoise it). */
export function useDocSnapshot<T>(ref: DocumentReference<T> | null): SnapshotState<T | null> {
  const [delivered, setDelivered] = useState<Delivered<T | null> | null>(null);

  useEffect(() => {
    if (!ref) return;
    return onSnapshot(
      ref,
      (snap) =>
        setDelivered({ source: ref, data: snap.exists() ? snap.data() : null, error: null }),
      (error) => setDelivered({ source: ref, data: null, error }),
    );
  }, [ref]);

  if (!ref) return { data: null, loading: false, error: null };
  if (delivered?.source !== ref) return { data: null, loading: true, error: null };
  return { data: delivered.data, loading: false, error: delivered.error };
}
