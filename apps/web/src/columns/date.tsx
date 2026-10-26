import type { DateSettings, DateValue } from '@atrium/shared';
import { DatePicker } from '@vibe/core';
import { Alert, Calendar } from '@vibe/icons';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { formatDay, isBeforeToday, parseIsoDate, toIsoDate } from './format';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function DateCell({ value, ctx }: CellProps<DateValue, DateSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Calendar aria-hidden="true" />
        </span>
      </div>
    );
  }
  // monday flags a date that has passed while the row's status is not "done".
  const overdue = !ctx.rowDone && isBeforeToday(value.date);
  return (
    <div className={styles.root}>
      {overdue ? (
        <span className={styles.overdue} role="img" aria-label="Overdue">
          <Alert aria-hidden="true" />
        </span>
      ) : null}
      <span className={styles.text}>{formatDay(value.date)}</span>
    </div>
  );
}

function DateEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<DateValue, DateSettings>) {
  const pick = (date: Date | undefined) => {
    if (!date) return;
    onChange({ date: toIsoDate(date), ...(value?.time ? { time: value.time } : {}) });
    onClose();
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        <DatePicker
          date={value ? parseIsoDate(value.date) : undefined}
          onDateChange={(date) => pick(date as Date | undefined)}
        />
        <div className={popups.footer}>
          <button type="button" className={popups.linkButton} onClick={() => pick(new Date())}>
            Today
          </button>
          <button
            type="button"
            className={popups.linkButton}
            onClick={() => {
              onChange(null);
              onClose();
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const dateUi = defineColumnUi<DateValue, DateSettings>({
  type: 'date',
  icon: Calendar,
  tone: 'purple',
  editor: 'popover',
  Cell: DateCell,
  Editor: DateEditor,
});
