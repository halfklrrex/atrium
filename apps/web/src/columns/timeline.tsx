import { columnRegistry, type TimelineSettings, type TimelineValue } from '@atrium/shared';
import { Calendar } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function TimelineCell({ value, settings, ctx }: CellProps<TimelineValue, TimelineSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Calendar aria-hidden="true" />
        </span>
      </div>
    );
  }

  const text = columnRegistry.toText('timeline', value, settings);

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={text} term={ctx.highlight} />
      </span>
    </div>
  );
}

export const timelineUi = defineColumnUi<TimelineValue, TimelineSettings>({
  type: 'timeline',
  icon: Calendar,
  tone: 'purple',
  editor: 'none',
  Cell: TimelineCell,
});
