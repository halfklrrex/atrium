import { Loader } from '@vibe/core';
import { useMemo, type CSSProperties } from 'react';
import { todayIso } from '../../../lib/date-grid';
import { formatAmount, UNASSIGNED_ID } from '../../board-workload/workload-model';
import styles from '../dashboard.module.css';
import type { WidgetDataProps } from './NumbersWidget';
import { buildWorkloadWidgetModel, type WorkloadWidgetSettings } from './workload-widget-model';

/** People down the side, weeks or months across, each cell tinted by how loaded the person is. */
export function WorkloadWidget({
  settings,
  boards,
  loading,
  widgetBoardIds,
  userName,
}: WidgetDataProps & {
  settings: WorkloadWidgetSettings;
  userName?: (uid: string) => string | undefined;
}) {
  const today = useMemo(() => todayIso(), []);
  const result = useMemo(
    () => buildWorkloadWidgetModel({ boards, widgetBoardIds, settings, today, nameOf: userName }),
    [boards, widgetBoardIds, settings, today, userName],
  );
  if (loading) {
    return (
      <div className={styles.widgetNote} role="status">
        <Loader size="small" />
      </div>
    );
  }
  const { model } = result;
  if (!model) {
    return (
      <div className={styles.widgetNote}>
        None of the boards has a Date or Timeline column to place items.
      </div>
    );
  }
  if (model.rows.length === 0 || model.noItemsDated) {
    return <div className={styles.widgetNote}>No dated items to show.</div>;
  }
  const unit = settings.bucket === 'month' ? 'month' : 'week';
  return (
    <div className={styles.workloadWidget}>
      <div className={styles.workloadScroll}>
        <div
          role="grid"
          aria-label={result.summary}
          className={styles.workloadGrid}
          style={{ '--workload-cells': model.axis.cells.length } as CSSProperties}
        >
          <div role="row" className={styles.workloadRow}>
            <div role="columnheader" className={`${styles.workloadHead} ${styles.workloadPerson}`}>
              People
            </div>
            {model.axis.cells.map((cell) => (
              <div
                key={cell.key}
                role="columnheader"
                className={styles.workloadHead}
                title={cell.label}
              >
                {cell.label.split(' ')[0]}
              </div>
            ))}
          </div>
          {model.rows.map((row) => (
            <div key={row.id} role="row" className={styles.workloadRow}>
              <div
                role="rowheader"
                className={`${styles.workloadPerson} ${row.id === UNASSIGNED_ID ? styles.workloadUnassigned : ''}`}
                title={row.name}
              >
                {row.name}
              </div>
              {row.cells.map((cell) => (
                <div key={cell.key} role="gridcell" className={styles.workloadCell}>
                  {cell.entries.length > 0 ? (
                    <span
                      className={styles.workloadTint}
                      data-level={cell.level}
                      title={cell.entries.map((e) => e.item.name).join(', ')}
                      aria-label={`${row.name}, ${unit} ${cell.label}: ${formatAmount(cell.value)} of ${formatAmount(cell.capacity)}`}
                    >
                      {formatAmount(cell.value)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {result.skippedBoards.length > 0 ? (
        <p className={styles.tableNote} role="status">
          Skipped (no Date or Timeline column): {result.skippedBoards.join(', ')}
        </p>
      ) : null}
    </div>
  );
}
