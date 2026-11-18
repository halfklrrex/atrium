import type { FirestoreClient } from './index.mjs';

/** An in-memory `FirestoreClient` for tests (see `fake-client.mjs`). `initial` maps document paths to data. */
export declare function createFakeClient(
  initial?: Record<string, Record<string, unknown>>,
): FirestoreClient & {
  docs: Map<string, { data: Record<string, unknown>; updateTime: string }>;
  commits: unknown[];
};
