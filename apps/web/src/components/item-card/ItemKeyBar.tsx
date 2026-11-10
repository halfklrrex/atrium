import type { ItemDoc } from '../../data';
import type { TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import { ItemCell } from '../item-view/ItemCell';
import styles from './ItemCardDrawer.module.css';
import { keyBarEmptyHint, type KeySlot } from './item-panel-layout';

interface ItemKeyBarProps {
  item: ItemDoc;
  slots: readonly { slot: KeySlot; column: ColumnView }[];
  ctx: TableCtx;
  canEdit: boolean;
}

/**
 * The strip under the title that stays on every tab: the item's status, owner, due date and
 * priority as live cells (the same `ItemCell` as the fields). Nothing is drawn without a match.
 */
export function ItemKeyBar({ item, slots, ctx, canEdit }: ItemKeyBarProps) {
  if (slots.length === 0) return null;
  return (
    <dl className={styles.keyBar} aria-label="Key information">
      {slots.map(({ slot, column }) => (
        <div key={slot} className={styles.keySlot} role="group">
          <dt className={styles.keyLabel} title={column.def.title}>
            {column.def.title}
          </dt>
          <dd className={styles.keyValue}>
            <ItemCell
              item={item}
              column={column}
              ctx={ctx}
              canEdit={canEdit}
              className={styles.keyCell}
              emptyHint={keyBarEmptyHint(column.def.type)}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
