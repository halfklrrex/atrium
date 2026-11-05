import { Loader } from '@vibe/core';
import { useMemo } from 'react';
import styles from '../dashboard.module.css';
import { buildNumbersModel, formatNumber, type NumbersSettings } from './numbers-model';
import type { WidgetBoardData } from './widget-columns';

export interface WidgetDataProps {
  boards: readonly WidgetBoardData[];
  loading: boolean;
  widgetBoardIds: readonly string[];
}

/** One big number: the count, sum, average, minimum or maximum of a column. */
export function NumbersWidget({
  settings,
  boards,
  loading,
  widgetBoardIds,
}: WidgetDataProps & { settings: NumbersSettings }) {
  const model = useMemo(
    () => buildNumbersModel({ boards, widgetBoardIds, settings }),
    [boards, widgetBoardIds, settings],
  );
  if (loading) {
    return (
      <div className={styles.widgetNote} role="status">
        <Loader size="small" />
      </div>
    );
  }
  return (
    <div className={styles.numbers} role="group" aria-label={model.summary}>
      <span className={styles.bigNumber}>
        {model.value === null ? '–' : formatNumber(model.value)}
      </span>
      <span className={styles.caption}>{model.caption}</span>
    </div>
  );
}
