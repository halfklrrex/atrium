import classNames from 'classnames';
import type { CSSProperties } from 'react';
import { Popover } from '../Popover';
import type { ColumnView } from '../board-table/table-model';
import { WorkloadPopover } from './WorkloadPopover';
import { formatAmount, type WorkloadCell as Cell, type WorkloadMeasure } from './workload-model';
import styles from './workload.module.css';

export interface WorkloadCellProps {
  cell: Cell;
  personName: string;
  period: string;
  measure: WorkloadMeasure;
  unit: string;
  statusColumn: ColumnView | null;
  showToday: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenItem: (itemId: string) => void;
}

const LEVEL_TEXT = {
  empty: 'no work',
  under: 'light',
  balanced: 'balanced',
  over: 'over capacity',
} as const;

/**
 * One cell of the grid: the amount on a tint (light, balanced or overloaded) and, for over, a mark
 * after the number. Clicking it lists the items behind it.
 */
export function WorkloadCell({
  cell,
  personName,
  period,
  measure,
  unit,
  statusColumn,
  showToday,
  open,
  onOpenChange,
  onOpenItem,
}: WorkloadCellProps) {
  const slotClass = classNames(
    styles.cell,
    cell.weekend && styles.cellWeekend,
    cell.today && showToday && styles.cellToday,
  );
  const slotStyle = { '--tl-span': cell.span } as CSSProperties;
  if (cell.entries.length === 0) {
    return (
      <div
        className={slotClass}
        style={slotStyle}
        role="gridcell"
        aria-label={`${personName}, ${period}: no work`}
      />
    );
  }
  const value = formatAmount(cell.value);
  return (
    <div className={slotClass} style={slotStyle} role="gridcell">
      <Popover
        open={open}
        onClose={() => onOpenChange(false)}
        label={`${personName}, ${period}`}
        className={styles.cellPopover}
        panelClassName={styles.popoverPanel}
        trigger={
          <button
            type="button"
            className={styles.tint}
            data-level={cell.level}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`${personName}, ${period}: ${value}${measure === 'sum' ? unit : ''} of ${formatAmount(cell.capacity)} capacity, ${LEVEL_TEXT[cell.level]}`}
            onClick={() => onOpenChange(!open)}
          >
            {value}
            {cell.level === 'over' ? (
              <span className={styles.overMark} aria-hidden="true">
                !
              </span>
            ) : null}
          </button>
        }
      >
        <WorkloadPopover
          personName={personName}
          period={period}
          cell={cell}
          measure={measure}
          statusColumn={statusColumn}
          unit={unit}
          onOpenItem={onOpenItem}
        />
      </Popover>
    </div>
  );
}
