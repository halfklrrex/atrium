import type { AutoNumberSettings, AutoNumberValue } from '@atrium/shared';
import { Numbers } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function AutoNumberCell({ value, settings, ctx }: CellProps<AutoNumberValue, AutoNumberSettings>) {
  if (!value) return <div className={styles.root} />;

  const formatted = settings?.prefix
    ? `${settings.prefix}${value.auto_number}`
    : String(value.auto_number);

  return (
    <div className={styles.root}>
      <span className={styles.idBadge}>
        <Highlight text={formatted} term={ctx.highlight} />
      </span>
    </div>
  );
}

export const autoNumberUi = defineColumnUi<AutoNumberValue, AutoNumberSettings>({
  type: 'auto_number',
  icon: Numbers,
  tone: 'grey',
  editor: 'none',
  Cell: AutoNumberCell,
});
