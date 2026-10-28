import {
  computeTimelineProgress,
  getTimelineDurationDays,
  type TimelineSettings,
  type TimelineValue,
} from '@atrium/shared';
import { DatePicker } from '@vibe/core';
import { Calendar } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { formatDay, formatRange, parseIsoDate, toIsoDate } from './format';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

export function formatTimelineRange(from: string, to: string, now: Date = new Date()): string {
  if (from === to) return formatDay(from, now);
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    const sameYear = start.getFullYear() === now.getFullYear();
    const startPart = `${start.toLocaleDateString(undefined, { month: 'short' })} ${start.getDate()} - ${end.getDate()}`;
    return sameYear ? startPart : `${startPart}, ${start.getFullYear()}`;
  }
  return formatRange(from, to, now);
}

function TimelineCell({ value, settings, ctx }: CellProps<TimelineValue, TimelineSettings>) {
  const [hovered, setHovered] = useState(false);

  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Calendar aria-hidden="true" />
        </span>
      </div>
    );
  }

  const days = getTimelineDurationDays(value);
  const rangeText = formatTimelineRange(value.from, value.to);
  const showProgress = Boolean(settings?.showProgress);
  const progress = showProgress ? computeTimelineProgress(value) : 100;
  const displayText = hovered ? `${days}d` : rangeText;

  return (
    <div className={styles.root}>
      <div
        className={classNames(styles.timelinePill, showProgress && styles.timelinePillProgress)}
        title={`${days}d`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {showProgress ? (
          <div className={styles.timelineFill} style={{ width: `${progress}%` }} />
        ) : null}
        <span className={styles.timelineText}>
          <Highlight text={displayText} term={ctx.highlight} />
        </span>
      </div>
    </div>
  );
}

function TimelineEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<TimelineValue, TimelineSettings>) {
  const [range, setRange] = useState<{ date?: Date; endDate?: Date }>(() =>
    value ? { date: parseIsoDate(value.from), endDate: parseIsoDate(value.to) } : {},
  );

  const handleDateChange = (next: { date?: Date; endDate?: Date }) => {
    setRange(next);
    if (next.date && next.endDate) {
      const a = toIsoDate(next.date);
      const b = toIsoDate(next.endDate);
      const [from, to] = a <= b ? [a, b] : [b, a];
      onChange({ from, to });
      onClose();
    }
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        <DatePicker
          mode="range"
          date={range.date}
          endDate={range.endDate}
          onDateChange={handleDateChange}
        />
        <div className={popups.footer}>
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

export const timelineUi = defineColumnUi<TimelineValue, TimelineSettings>({
  type: 'timeline',
  icon: Calendar,
  tone: 'purple',
  editor: 'popover',
  Cell: TimelineCell,
  Editor: TimelineEditor,
});
