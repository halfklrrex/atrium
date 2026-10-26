import type { ColumnView } from '../board-table/table-model';
import type { TableCtx } from '../board-table/table-actions';
import type { ItemDoc } from '../../data';
import { getColumnUi } from '../../columns/registry';
import { ItemCell } from './ItemCell';
import styles from './ItemView.module.css';

interface FieldsPanelProps {
  item: ItemDoc;
  columns: readonly ColumnView[];
  ctx: TableCtx;
  canEdit: boolean;
}

/** Every board column as a label/value row, in the board's column order. */
export function FieldsPanel({ item, columns, ctx, canEdit }: FieldsPanelProps) {
  if (columns.length === 0) {
    return <p className={styles.muted}>This board has no columns yet.</p>;
  }
  return (
    <dl className={styles.fields} aria-label="Fields">
      {columns.map((column) => {
        const Icon = getColumnUi(column.def.type)?.icon;
        return (
          <div key={column.def.id} className={styles.field} role="group">
            <dt className={styles.fieldLabel}>
              {Icon ? <Icon aria-hidden="true" className={styles.fieldIcon} /> : null}
              <span className={styles.fieldTitle}>{column.def.title}</span>
            </dt>
            <dd className={styles.fieldValue}>
              <ItemCell item={item} column={column} ctx={ctx} canEdit={canEdit} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
