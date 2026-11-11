import { Button } from '@vibe/core';
import { Icon } from '@vibe/core';
import {
  NavigationChevronDown,
  NavigationChevronRight,
  NavigationChevronUp,
  Subitems,
  ThumbsUp,
} from '@vibe/icons';
import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { itemWrites, type BoardDoc, type ItemDoc, type ItemUpdateDoc } from '../../data';
import { authorLabel } from '../../lib/automation-actor';
import { formatRelativeShort } from '../../lib/format';
import { openItemFull } from '../board-table/open-item';
import { countMissingRequired } from '../board-table/required';
import type { TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import type { DescriptionValue } from '../item-view/description';
import { FieldsPanel } from '../item-view/FieldsPanel';
import { UserAvatar } from '../UserAvatar';
import { partitionGridFields, subitemSummary } from './item-panel-layout';
import styles from './ItemOverview.module.css';

const DescriptionEditor = lazy(() => import('../item-view/DescriptionEditor'));

const FIELDS_ID = 'item-panel-fields';

interface ItemOverviewProps {
  board: BoardDoc;
  item: ItemDoc;
  uid: string;
  /** Every board column in board order (the key bar's ones are left out of the grid). */
  columns: readonly ColumnView[];
  keyBarIds: ReadonlySet<string>;
  ctx: TableCtx;
  canEdit: boolean;
  /** Every active item of the board (the subitems row counts this item's children). */
  items: readonly ItemDoc[];
  subColumns: readonly ColumnView[];
  /** The item's updates, newest first. */
  updates: readonly ItemUpdateDoc[];
  /** Switch to Updates, optionally with an update focused or the composer ready. */
  onOpenUpdates: (options?: { focusUpdateId?: string; composer?: boolean }) => void;
}

/**
 * The panel's landing tab: the description, the item's fields in a compact grid, the subitems row
 * and the latest update. Mounted with `key={item.id}` so the "Show all fields" and "Show more"
 * states start closed for every item.
 */
export function ItemOverview({
  board,
  item,
  uid,
  columns,
  keyBarIds,
  ctx,
  canEdit,
  items,
  subColumns,
  updates,
  onOpenUpdates,
}: ItemOverviewProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [clampable, setClampable] = useState(false);
  const clamp = useMemo(() => ({ open: descOpen, onClampableChange: setClampable }), [descOpen]);
  const subs = useMemo(
    () => subitemSummary(items, item.id, subColumns),
    [items, item.id, subColumns],
  );
  const latest = updates[0];
  const boardId = board.id;
  const itemId = item.id;
  const saveDescription = useCallback(
    (value: DescriptionValue | null) => itemWrites.setDescription(uid, boardId, itemId, value),
    [uid, boardId, itemId],
  );
  const grid = partitionGridFields(columns, keyBarIds, { expanded });
  const missing = countMissingRequired(board.columns, item.values);
  const showFields = columns.length === 0 || grid.total > 0;

  return (
    <div className={styles.overview}>
      <section className={styles.block} aria-label="Description">
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Description</h3>
        </div>
        <Suspense fallback={<div className={styles.editorFallback} aria-busy="true" />}>
          <DescriptionEditor
            key={itemId}
            boardId={boardId}
            itemId={itemId}
            initial={(item.description?.doc as Record<string, unknown> | undefined) ?? null}
            readOnly={!canEdit}
            onSave={saveDescription}
            toolbar="focus"
            clamp={clamp}
          />
        </Suspense>
        {clampable ? (
          <div>
            <Button
              kind="tertiary"
              size="small"
              aria-expanded={descOpen}
              onClick={() => setDescOpen((v) => !v)}
            >
              {descOpen ? 'Show less' : 'Show more'}
            </Button>
          </div>
        ) : null}
      </section>

      {showFields ? (
        <section className={styles.block}>
          <div className={styles.blockHead}>
            <h3 className={styles.blockTitle}>Fields</h3>
            {missing > 0 ? (
              <span className={styles.requiredCount} data-testid="required-count">
                {missing === 1 ? '1 required empty' : `${missing} required empty`}
              </span>
            ) : null}
          </div>
          <div className={styles.fieldsHost}>
            <FieldsPanel
              id={FIELDS_ID}
              item={item}
              columns={grid.visible}
              ctx={ctx}
              canEdit={canEdit}
              layout="grid"
            />
          </div>
          {grid.hasMore ? (
            <div>
              <Button
                kind="tertiary"
                size="small"
                leftIcon={expanded ? NavigationChevronUp : NavigationChevronDown}
                aria-expanded={expanded}
                aria-controls={FIELDS_ID}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Show fewer' : `Show all fields (${grid.total})`}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {subs.total > 0 || canEdit ? (
        <SubitemsRow
          total={subs.total}
          done={subs.done}
          onOpen={() => openItemFull(board.id, itemId, { section: 'subitems' })}
        />
      ) : null}

      <section className={styles.block} aria-label={latest ? 'Latest update' : 'Updates'}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>{latest ? 'Latest update' : 'Updates'}</h3>
          {latest ? (
            <Button kind="tertiary" size="small" onClick={() => onOpenUpdates()}>
              {updates.length === 1 ? 'All 1 update' : `All ${updates.length} updates`}
            </Button>
          ) : null}
        </div>
        {latest ? (
          <UpdateTeaser
            update={latest}
            viewerId={user?.uid ?? ''}
            onOpen={() => onOpenUpdates({ focusUpdateId: latest.id })}
          />
        ) : null}
        {user ? (
          <button
            type="button"
            className={styles.composerStub}
            aria-label="Write an update"
            onClick={() => onOpenUpdates({ composer: true })}
          >
            <UserAvatar
              uid={user.uid}
              name={user.displayName ?? undefined}
              photoURL={user.photoURL}
              size="small"
            />
            <span className={styles.composerStubText}>Write an update…</span>
          </button>
        ) : null}
      </section>
    </div>
  );
}

function SubitemsRow({
  total,
  done,
  onOpen,
}: {
  total: number;
  done: number | null;
  onOpen: () => void;
}) {
  const summary =
    total === 0
      ? 'None yet'
      : done === null
        ? total === 1
          ? '1 subitem'
          : `${total} subitems`
        : `${done} of ${total} done`;
  return (
    <button
      type="button"
      className={styles.subitemsRow}
      aria-label={`Subitems, ${summary}. Open in the full item`}
      onClick={onOpen}
    >
      <Icon icon={Subitems} size={16} aria-hidden />
      <span className={styles.subitemsLabel}>Subitems</span>
      <span className={styles.subitemsSummary}>{summary}</span>
      {total > 0 && done !== null ? (
        <span className={styles.progressTrack} aria-hidden="true">
          <span className={styles.progressFill} style={{ transform: `scaleX(${done / total})` }} />
        </span>
      ) : null}
      <Icon icon={NavigationChevronRight} size={16} aria-hidden className={styles.chevron} />
    </button>
  );
}

function UpdateTeaser({
  update,
  viewerId,
  onOpen,
}: {
  update: ItemUpdateDoc;
  viewerId: string;
  onOpen: () => void;
}) {
  const name = authorLabel(update.authorId, update.authorName, viewerId);
  const when = formatRelativeShort(update.createdAt);
  const likes = update.likes.length;
  const replies = update.repliesCount;
  return (
    <button
      type="button"
      className={styles.teaser}
      aria-label={`Latest update from ${name}, ${when}. Open in Updates`}
      onClick={onOpen}
    >
      <span className={styles.teaserHead}>
        <UserAvatar
          uid={update.authorId}
          name={update.authorName}
          photoURL={update.authorPhotoUrl}
          size="small"
        />
        <span className={styles.teaserAuthor}>{name}</span>
        <span className={styles.teaserTime}>{when}</span>
      </span>
      <span className={styles.teaserText}>{update.content}</span>
      {likes > 0 || replies > 0 ? (
        <span className={styles.teaserMeta}>
          {likes > 0 ? (
            <span className={styles.teaserMetaItem}>
              <Icon icon={ThumbsUp} size={14} aria-hidden />
              {likes}
            </span>
          ) : null}
          {replies > 0 ? <span>{replies === 1 ? '1 reply' : `${replies} replies`}</span> : null}
        </span>
      ) : null}
    </button>
  );
}
