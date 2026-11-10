import { Button } from '@vibe/core';
import { NavigationChevronDown, NavigationChevronUp } from '@vibe/icons';
import { Suspense, lazy, useCallback, useState } from 'react';
import { itemWrites, type BoardDoc, type ItemDoc } from '../../data';
import { countMissingRequired } from '../board-table/required';
import type { TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import type { DescriptionValue } from '../item-view/description';
import { FieldsPanel } from '../item-view/FieldsPanel';
import { partitionGridFields } from './item-panel-layout';
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
}

/**
 * The panel's landing tab: the description, then the item's fields in a compact grid. Mounted with
 * `key={item.id}` so the "Show all fields" state starts closed for every item.
 */
export function ItemOverview({
  board,
  item,
  uid,
  columns,
  keyBarIds,
  ctx,
  canEdit,
}: ItemOverviewProps) {
  const [expanded, setExpanded] = useState(false);
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
          />
        </Suspense>
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
    </div>
  );
}
