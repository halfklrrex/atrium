import { Add } from '@vibe/icons';
import { useMemo, useState } from 'react';
import type { ItemDoc } from '../../data';
import { comparePositions, positionAfterAll } from '../../lib/positions';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import { InlineEdit } from '../InlineEdit';
import { ItemCell } from './ItemCell';
import styles from './ItemView.module.css';

interface ItemSubitemsProps {
  parent: ItemDoc;
  /** Every active item of the board; the parent's subitems are picked from it. */
  items: readonly ItemDoc[];
  subitemColumns: readonly ColumnView[];
  /** Action context of the subitem columns (`scope: 'subitems'`). */
  subCtx: TableCtx;
  /** The board-level context, for adding the first subitem (it creates the subitem columns). */
  ctx: TableCtx;
  canEdit: boolean;
}

/** A compact list of the item's subitems: name plus the subitem columns, and "+ Add subitem". */
export function ItemSubitems({
  parent,
  items,
  subitemColumns,
  subCtx,
  ctx,
  canEdit,
}: ItemSubitemsProps) {
  const subitems = useMemo(
    () => items.filter((i) => i.parentItemId === parent.id).sort(comparePositions),
    [items, parent.id],
  );
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setDraft('');
    await tableActions.addSubitem(ctx, parent, { position: positionAfterAll(subitems), name });
  };

  return (
    <section className={styles.section} aria-label="Subitems">
      <h3 className={styles.sectionTitle}>
        Subitems{subitems.length > 0 ? ` (${subitems.length})` : ''}
      </h3>
      {subitems.length > 0 ? (
        <ul className={styles.subitems}>
          {subitems.map((sub) => (
            <li key={sub.id} className={styles.subitem}>
              <InlineEdit
                value={sub.name}
                readOnly={!canEdit}
                ariaLabel={`Subitem name ${sub.name}`}
                className={styles.subitemName}
                onCommit={(name) => void tableActions.renameItem(subCtx, sub.id, name)}
              />
              <div className={styles.subitemCells}>
                {subitemColumns.map((column) => (
                  <div key={column.def.id} className={styles.subitemCellWrap}>
                    <span className={styles.subitemCellLabel}>{column.def.title}</span>
                    <ItemCell item={sub} column={column} ctx={subCtx} canEdit={canEdit} />
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>No subitems yet.</p>
      )}
      {canEdit ? (
        adding ? (
          <input
            className={styles.addInput}
            autoFocus
            aria-label="New subitem name"
            placeholder="Subitem name, then Enter"
            value={draft}
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              setAdding(false);
              setDraft('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void add();
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                setAdding(false);
                setDraft('');
              }
            }}
          />
        ) : (
          <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>
            <Add aria-hidden="true" />
            Add subitem
          </button>
        )
      ) : null}
    </section>
  );
}
