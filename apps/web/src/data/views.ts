import {
  MAIN_VIEW_ID,
  MAIN_VIEW_NAME,
  MAIN_VIEW_POSITION,
  defaultViewSettings,
  type TimestampLike,
} from '@atrium/shared';
import { comparePositions } from '../lib/positions';
import type { BoardViewDoc } from './model';

const EPOCH: TimestampLike = {
  seconds: 0,
  nanoseconds: 0,
  toDate: () => new Date(0),
  toMillis: () => 0,
};

/** The "Main table" view as the client sees it until somebody saves its settings. */
export function syntheticMainView(): BoardViewDoc {
  return {
    id: MAIN_VIEW_ID,
    name: MAIN_VIEW_NAME,
    type: 'table',
    position: MAIN_VIEW_POSITION,
    ownerId: null,
    settings: defaultViewSettings(),
    createdAt: EPOCH,
    createdBy: '',
    updatedAt: EPOCH,
    updatedBy: '',
    synthetic: true,
  };
}

/**
 * Shared views plus the caller's personal ones, in tab order. `main` is always first: a stored one
 * wins, a missing one is synthesised. Personal views of other users never show (the query only
 * returns the caller's, this also drops stray ones).
 */
export function mergeViews(
  shared: readonly BoardViewDoc[],
  personal: readonly BoardViewDoc[],
  uid: string,
): BoardViewDoc[] {
  const byId = new Map<string, BoardViewDoc>();
  for (const view of [...shared, ...personal]) {
    if (view.ownerId !== null && view.ownerId !== uid) continue;
    byId.set(view.id, view);
  }
  const main = byId.get(MAIN_VIEW_ID) ?? syntheticMainView();
  byId.delete(MAIN_VIEW_ID);
  return [main, ...[...byId.values()].sort(comparePositions)];
}
