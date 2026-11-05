import { Loader } from '@vibe/core';
import { useMemo } from 'react';
import styles from '../dashboard.module.css';
import { buildBatteryModel, type BatterySettings } from './battery-model';
import type { WidgetDataProps } from './NumbersWidget';

/** Progress by status: one segment per label and the share of items that are done. */
export function BatteryWidget({
  settings,
  boards,
  loading,
  widgetBoardIds,
}: WidgetDataProps & { settings: BatterySettings }) {
  const model = useMemo(
    () => buildBatteryModel({ boards, widgetBoardIds, settings }),
    [boards, widgetBoardIds, settings],
  );
  if (loading) {
    return (
      <div className={styles.widgetNote} role="status">
        <Loader size="small" />
      </div>
    );
  }
  if (model.total === 0) {
    return (
      <div className={styles.widgetNote}>
        {model.boardsWithoutStatus > 0
          ? 'No status column on these boards.'
          : 'No items to show yet.'}
      </div>
    );
  }
  return (
    <div className={styles.battery} role="group" aria-label={model.summary}>
      <span className={styles.batteryPercent}>{model.percent}% done</span>
      <ul className={styles.batteryBar} aria-hidden="true">
        {model.segments.map((segment) => (
          <li
            key={segment.key}
            className={styles.batterySegment}
            style={{
              flexGrow: segment.count,
              flexBasis: 0,
              ...(segment.color ? { background: segment.color } : {}),
            }}
          />
        ))}
      </ul>
      <ul className={styles.legend}>
        {model.segments.map((segment) => (
          <li key={segment.key} className={styles.legendItem}>
            <span
              className={styles.swatch}
              aria-hidden="true"
              style={segment.color ? { background: segment.color } : undefined}
            />
            {segment.label} {segment.count}
          </li>
        ))}
      </ul>
    </div>
  );
}
