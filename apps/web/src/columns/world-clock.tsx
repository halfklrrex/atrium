import { columnRegistry, type WorldClockSettings, type WorldClockValue } from '@atrium/shared';
import { Time } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function WorldClockCell({ value, settings, ctx }: CellProps<WorldClockValue, WorldClockSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Time aria-hidden="true" />
        </span>
      </div>
    );
  }

  const text = columnRegistry.toText('world_clock', value, settings);

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={text} term={ctx.highlight} />
      </span>
    </div>
  );
}

export const worldClockUi = defineColumnUi<WorldClockValue, WorldClockSettings>({
  type: 'world_clock',
  icon: Time,
  tone: 'blue',
  editor: 'none',
  Cell: WorldClockCell,
});
