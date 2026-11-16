import { Add, Open } from '@vibe/icons';
import { Tooltip } from '@vibe/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ItemDoc } from '../../data';
import { comparePositions, positionAfterAll } from '../../lib/positions';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import { InlineEdit } from '../InlineEdit';
import { ItemCell } from './ItemCell';
import styles from './ItemView.module.css';

const DOUBLE_CLICK_MS = 250;

interface ItemSubitemsProps {
  parent: ItemDoc;
  /** Every active item of the board; the parent's subitems are picked from it. */
  items: readonly ItemDoc[];
  /** The columns a subitem row shows (the board's columns). */
  subColumns: readonly ColumnView[];
  /** Action context of the subitems' columns. */
  subCtx: TableCtx;
  /** The board-level context, for adding a subitem. */
  ctx: TableCtx;
  canEdit: boolean;
  /** Open a subitem's own full page. */
  onOpen: (subitemId: string) => void;
}

/** A compact list of the item's subitems: name plus the subitem columns, and "+ Add subitem". */
export function ItemSubitems({
  parent,
  items,
  subColumns,
  subCtx,
  ctx,
  canEdit,
  onOpen,
}: ItemSubitemsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // A double click renames; the single click that starts it must not open the page first.
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(openTimer.current ?? undefined), []);
  const clickName = (id: string) => {
    if (!canEdit) return onOpen(id);
    clearTimeout(openTimer.current ?? undefined);
    openTimer.current = setTimeout(() => onOpen(id), DOUBLE_CLICK_MS);
  };
  const renameName = (id: string) => {
    clearTimeout(openTimer.current ?? undefined);
    setRenamingId(id);
  };
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
    <section id="item-view-subitems" className={styles.section} aria-label="Subitems">
      <h3 className={styles.sectionTitle}>
        Subitems{subitems.length > 0 ? ` (${subitems.length})` : ''}
      </h3>
      {subitems.length > 0 ? (
        <ul className={styles.subitems}>
          {subitems.map((sub) => (
            <li key={sub.id} className={styles.subitem}>
              <div className={styles.subitemHead}>
                {renamingId === sub.id ? (
                  <InlineEdit
                    value={sub.name}
                    editing
                    onEditingChange={(editing) => {
                      if (!editing) setRenamingId(null);
                    }}
                    ariaLabel={`Subitem name ${sub.name}`}
                    className={styles.subitemName}
                    maxLength={500}
                    onCommit={(name) => void tableActions.renameItem(subCtx, sub.id, name)}
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.subitemLink}
                    onClick={(event) => (event.detail === 0 ? onOpen(sub.id) : clickName(sub.id))}
                    onKeyDown={(event) => {
                      if (event.key === 'F2' && canEdit) {
                        event.preventDefault();
                        renameName(sub.id);
                      }
                    }}
                    title={canEdit ? 'Open (F2 or double click to rename)' : undefined}
                    onDoubleClick={() => canEdit && renameName(sub.id)}
                  >
                    {sub.name}
                  </button>
                )}
                {(sub.updatesCount ?? 0) > 0 ? (
                  <span
                    className={styles.subitemBadge}
                    aria-label={`${sub.updatesCount} updates`}
                    title={`${sub.updatesCount} updates`}
                  >
                    {(sub.updatesCount ?? 0) > 9 ? '9+' : sub.updatesCount}
                  </span>
                ) : null}
                <Tooltip content="Open subitem">
                  <button
                    type="button"
                    className={styles.subitemOpen}
                    aria-label={`Open ${sub.name}`}
                    onClick={() => onOpen(sub.id)}
                  >
                    <Open aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
              <div className={styles.subitemCells}>
                {subColumns.map((column) => (
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
