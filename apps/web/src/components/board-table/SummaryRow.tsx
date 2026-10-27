import {
  columnRegistry,
  type AggregateResult,
  type GroupDef,
  type NumbersSettings,
} from '@atrium/shared';
import { memo, useMemo, type CSSProperties } from 'react';
import { BatteryBar } from '../battery/BatteryBar';
import { formatNumber, formatRange } from '../../columns/format';
import type { ItemDoc } from '../../data';
import { useTableEnv } from './table-env';
import { derivedCellValue } from './derived';
import type { ColumnView } from './table-model';
import styles from './table.module.css';

/** The footer summary of one column over a group's items (P1b spec section 4). */
export const SummaryCell = memo(function SummaryCell({
  column,
  items,
}: {
  column: ColumnView;
  items: readonly ItemDoc[];
}) {
  const { ctx } = useTableEnv();
  const result = useMemo(
    () =>
      columnRegistry.aggregate(
        column.def.type,
        items.map((item) =>
          columnRegistry.isDerived(column.def.type)
            ? derivedCellValue(ctx.boardId, ctx.columns, column.def, item)
            : item.values[column.def.id],
        ),
        column.settings,
      ),
    [column, items, ctx.boardId, ctx.columns],
  );
  return (
    <div className={styles.summaryCell} role="gridcell">
      {result ? <SummaryContent result={result} column={column} /> : null}
    </div>
  );
});

function SummaryContent({ result, column }: { result: AggregateResult; column: ColumnView }) {
  switch (result.kind) {
    case 'distribution': {
      if (result.total === 0) return null;
      return (
        <BatteryBar
          className={styles.battery}
          segments={result.segments}
          total={result.total}
          label={`${column.def.title} summary`}
        />
      );
    }
    case 'sum':
      return (
        <>
          <span>{formatNumber(result.sum, column.settings as NumbersSettings)}</span>
          <span className={styles.summaryCaption}>sum</span>
        </>
      );
    case 'range':
      return (
        <span className={styles.rangePill}>{formatRange(result.earliest, result.latest)}</span>
      );
    case 'ratio':
      return (
        <span>
          {result.filled}/{result.total}
        </span>
      );
  }
}

/** The 36px footer row: blank under the name column, one summary under each value column. */
export function SummaryRow({ group, items }: { group: GroupDef; items: readonly ItemDoc[] }) {
  const env = useTableEnv();
  return (
    <div
      role="row"
      className={styles.summaryRow}
      style={{ '--group-color': group.color } as CSSProperties}
    >
      <div className={styles.summaryBlank} />
      {env.columns.map((column) => (
        <SummaryCell key={column.def.id} column={column} items={items} />
      ))}
      <div className={styles.summaryBlank} />
    </div>
  );
}
