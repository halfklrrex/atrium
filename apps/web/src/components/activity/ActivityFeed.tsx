import type { ColumnDef } from '@atrium/shared';
import { Button, Loader } from '@vibe/core';
import { useMemo, type ReactNode } from 'react';
import type { ActivityState } from '../../data/activity';
import { EmptyState, type EmptyStateAction } from '../EmptyState/EmptyState';
import { NoSearchResults } from '../illustrations';
import { ActivityRow } from './ActivityRow';
import styles from './ActivityFeed.module.css';

export interface ActivityFeedProps {
  state: ActivityState;
  columns: readonly ColumnDef[];
  showItem?: boolean;
  onOpenItem?: (itemId: string) => void;
  /** What the empty list says; `filtered` swaps in the "matches these filters" copy. */
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyBody?: ReactNode;
  label: string;
}

/**
 * The states shared by the item card's tab and the board panel: loading, error with Retry, empty,
 * and the list with "Load more". Items whose newest entry is a deletion are not linked.
 */
export function ActivityFeed({
  state,
  columns,
  showItem = false,
  onOpenItem,
  filtered = false,
  onClearFilters,
  emptyBody,
  label,
}: ActivityFeedProps) {
  const { data, loading, error, hasMore, loadMore, retry } = state;
  // Newest first: the first entry seen for an item says whether it still exists.
  const deleted = useMemo(() => {
    const seen = new Set<string>();
    const gone = new Set<string>();
    for (const e of data) {
      if (!e.itemId || seen.has(e.itemId)) continue;
      seen.add(e.itemId);
      if (e.kind === 'item_deleted') gone.add(e.itemId);
    }
    return gone;
  }, [data]);

  if (loading) {
    return (
      <div className={styles.center} role="status" aria-label="Loading activity">
        <Loader size="medium" />
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.empty}>
        <EmptyState
          size="panel"
          title="Activity is unavailable"
          body="We couldn't load the activity log. Check your connection and try again."
          primaryAction={{ label: 'Retry', onClick: retry }}
        />
      </div>
    );
  }
  if (data.length === 0) {
    const clear: EmptyStateAction | undefined =
      filtered && onClearFilters ? { label: 'Clear filters', onClick: onClearFilters } : undefined;
    return (
      <div className={styles.empty}>
        <EmptyState
          size="panel"
          illustration={filtered ? <NoSearchResults /> : undefined}
          title={filtered ? 'No activity matches these filters' : 'No activity yet'}
          body={
            filtered
              ? 'Try a different person, column or date range.'
              : (emptyBody ?? 'Changes will show up here as they happen.')
          }
          primaryAction={clear}
        />
      </div>
    );
  }
  return (
    <>
      <ul className={styles.list} aria-label={label}>
        {data.map((event) => (
          <ActivityRow
            key={event.id}
            event={event}
            columns={columns}
            showItem={showItem}
            onOpenItem={
              onOpenItem && event.itemId && !deleted.has(event.itemId) ? onOpenItem : undefined
            }
          />
        ))}
      </ul>
      {hasMore ? (
        <div className={styles.more}>
          <Button kind="tertiary" size="small" onClick={loadMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}
