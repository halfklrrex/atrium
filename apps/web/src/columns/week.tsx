import { columnRegistry, type WeekSettings, type WeekValue } from '@atrium/shared';
import { Calendar } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function WeekCell({ value, settings, ctx }: CellProps<WeekValue, WeekSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Calendar aria-hidden="true" />
        </span>
      </div>
    );
  }

  const text = columnRegistry.toText('week', value, settings);

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={text} term={ctx.highlight} />
      </span>
    </div>
  );
}

export const weekUi = defineColumnUi<WeekValue, WeekSettings>({
  type: 'week',
  icon: Calendar,
  tone: 'indigo',
  editor: 'none',
  Cell: WeekCell,
});
