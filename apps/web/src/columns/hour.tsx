import { columnRegistry, type HourSettings, type HourValue } from '@atrium/shared';
import { Time } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function HourCell({ value, settings, ctx }: CellProps<HourValue, HourSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Time aria-hidden="true" />
        </span>
      </div>
    );
  }

  const text = columnRegistry.toText('hour', value, settings);

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={text} term={ctx.highlight} />
      </span>
    </div>
  );
}

export const hourUi = defineColumnUi<HourValue, HourSettings>({
  type: 'hour',
  icon: Time,
  tone: 'teal',
  editor: 'none',
  Cell: HourCell,
});
