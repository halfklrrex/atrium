import type { StatusLabel } from '@atrium/shared';
import { shortDateLabel } from '../../lib/date-grid';
import { textToneFor } from '../board-date-views/date-view-model';
import { cardLabel } from '../board-kanban/kanban-model';
import type { ColumnView } from '../board-table/table-model';
import { formatAmount, type WorkloadCell, type WorkloadMeasure } from './workload-model';
import styles from './workload.module.css';

export interface WorkloadPopoverProps {
  personName: string;
  /** "Mon, Oct 26", "Week 43 (19 - 25)" or "October 2026". */
  period: string;
  cell: WorkloadCell;
  measure: WorkloadMeasure;
  /** The first status column; its label is the chip beside each item. */
  statusColumn: ColumnView | null;
  /** Unit of the Numbers column, e.g. "h", when it has one. */
  unit: string;
  onOpenItem: (itemId: string) => void;
}

const rangeText = (from: string, to: string): string =>
  from === to ? shortDateLabel(from) : `${shortDateLabel(from)} - ${shortDateLabel(to)}`;

function StatusChip({ label }: { label: StatusLabel }) {
  return (
    <span
      className={styles.chip}
      data-tone={textToneFor(label.color)}
      style={{ background: label.color }}
    >
      {label.label}
    </span>
  );
}

/** What fills a cell: the person's items in the period, each opening its card. */
export function WorkloadPopover({
  personName,
  period,
  cell,
  measure,
  statusColumn,
  unit,
  onOpenItem,
}: WorkloadPopoverProps) {
  return (
    <div className={styles.popover}>
      <div className={styles.popoverHead}>
        <span className={styles.popoverTitle}>{personName}</span>
        <span className={styles.popoverSub}>{period}</span>
        <span className={styles.popoverSub}>
          {measure === 'sum'
            ? `${formatAmount(cell.value)}${unit} of ${formatAmount(cell.capacity)}${unit} capacity`
            : `${formatAmount(cell.value)} of ${formatAmount(cell.capacity)} item-days capacity`}
        </span>
      </div>
      <ul className={styles.popoverList} aria-label={`Items of ${personName}`}>
        {cell.entries.map(({ item, amount, from, to }) => {
          const label = statusColumn ? cardLabel(item, statusColumn) : null;
          return (
            <li key={item.id} className={styles.popoverItem}>
              <button
                type="button"
                className={styles.popoverButton}
                onClick={() => onOpenItem(item.id)}
              >
                <span className={styles.popoverName}>{item.name}</span>
                {label ? <StatusChip label={label} /> : null}
                <span className={styles.popoverDates}>{rangeText(from, to)}</span>
                {measure === 'sum' ? (
                  <span className={styles.popoverDates}>
                    {formatAmount(amount)}
                    {unit}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
