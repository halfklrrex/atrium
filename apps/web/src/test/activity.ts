import type { ActivityEvent } from '@atrium/shared';
import type { ActivityDoc } from '../data/activity';
import { ts } from './fixtures';

/** An activity entry as the Functions write it: a 5 minute old edit by Avery Quinn. */
export function makeActivity(id: string, over: Partial<ActivityEvent> = {}): ActivityDoc {
  const now = Date.now();
  return {
    id,
    kind: 'value_changed',
    createdAt: ts(now - 5 * 60_000),
    expiresAt: ts(now + 80 * 86_400_000),
    actorId: 'u1',
    actorName: 'Avery Quinn',
    actorPhotoUrl: null,
    itemId: 'i1',
    itemName: 'Ship the pipeline',
    parentItemId: null,
    columnId: null,
    columnTitle: null,
    columnType: null,
    groupId: null,
    groupTitle: null,
    data: {},
    ...over,
  };
}
