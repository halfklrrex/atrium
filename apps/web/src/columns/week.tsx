import { getWeekDateRange, type WeekSettings, type WeekValue } from '@atrium/shared';
import { DatePicker } from '@vibe/core';
import { Calendar } from '@vibe/icons';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { formatRange, parseIsoDate, toIsoDate } from './format';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function formatWeekCell(startDate: string, endDate: string): string {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    const now = new Date();
    const sameYear = start.getFullYear() === now.getFullYear();
    const startPart = `${start.toLocaleDateString(undefined, { month: 'short' })} ${start.getDate()} - ${end.getDate()}`;
    return sameYear ? startPart : `${startPart}, ${start.getFullYear()}`;
  }
  return formatRange(startDate, endDate);
}

function WeekCell({ value, ctx }: CellProps<WeekValue, WeekSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Calendar aria-hidden="true" />
        </span>
      </div>
    );
  }

  const text = formatWeekCell(value.week.startDate, value.week.endDate);

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={text} term={ctx.highlight} />
      </span>
    </div>
  );
}

function WeekEditor({
  value,
  settings,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<WeekValue, WeekSettings>) {
  const firstDayOfWeek = settings?.firstDayOfWeek ?? 'monday';

  const pick = (date: Date | undefined) => {
    if (!date) return;
    const week = getWeekDateRange(toIsoDate(date), firstDayOfWeek);
    onChange({ week });
    onClose();
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        <DatePicker
          date={value ? parseIsoDate(value.week.startDate) : undefined}
          firstDayOfWeek={firstDayOfWeek === 'monday' ? 1 : 0}
          onDateChange={(date) => pick(date as Date | undefined)}
        />
        <div className={popups.footer}>
          <button type="button" className={popups.linkButton} onClick={() => pick(new Date())}>
            This week
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

export const weekUi = defineColumnUi<WeekValue, WeekSettings>({
  type: 'week',
  icon: Calendar,
  tone: 'indigo',
  editor: 'popover',
  Cell: WeekCell,
  Editor: WeekEditor,
});
