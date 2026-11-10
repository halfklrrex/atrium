import classNames from 'classnames';
import type { ColumnView } from '../board-table/table-model';
import type { TableCtx } from '../board-table/table-actions';
import type { ItemDoc } from '../../data';
import { getColumnUi } from '../../columns/registry';
import { ItemCell } from './ItemCell';
import { isWideFieldType } from '../item-card/item-panel-layout';
import styles from './ItemView.module.css';

interface FieldsPanelProps {
  item: ItemDoc;
  columns: readonly ColumnView[];
  ctx: TableCtx;
  canEdit: boolean;
  /** `'rows'` (label left, value right) or the side panel's two-column `'grid'` (label above). */
  layout?: 'rows' | 'grid';
  /** Id of the list, for a control that points at it with `aria-controls`. */
  id?: string;
}

/** Every board column as a label/value row, in the board's column order. */
export function FieldsPanel({
  item,
  columns,
  ctx,
  canEdit,
  layout = 'rows',
  id,
}: FieldsPanelProps) {
  if (columns.length === 0) {
    return <p className={styles.muted}>This board has no columns yet.</p>;
  }
  return (
    <dl
      id={id}
      className={classNames(styles.fields, layout === 'grid' && styles.fieldsGrid)}
      aria-label="Fields"
    >
      {columns.map((column) => {
        const Icon = getColumnUi(column.def.type)?.icon;
        return (
          <div
            key={column.def.id}
            className={styles.field}
            role="group"
            data-wide={layout === 'grid' && isWideFieldType(column.def.type) ? 'true' : undefined}
          >
            <dt className={styles.fieldLabel}>
              {Icon ? <Icon aria-hidden="true" className={styles.fieldIcon} /> : null}
              <span className={styles.fieldTitle} title={column.def.description || undefined}>
                {column.def.title}
              </span>
              {column.def.required ? (
                <span
                  className={styles.requiredMark}
                  data-testid={`field-required-mark-${column.def.id}`}
                  aria-label="Required column"
                  title="Required column"
                >
                  *
                </span>
              ) : null}
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
