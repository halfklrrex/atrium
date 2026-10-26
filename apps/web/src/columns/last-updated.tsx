import type { LastUpdatedSettings, LastUpdatedValue } from '@atrium/shared';
import { Update } from '@vibe/icons';
import { UserAvatar } from '../components/UserAvatar';
import styles from './cells.module.css';
import { formatDay } from './format';
import { defineColumnUi, type CellProps } from './types';

function LastUpdatedCell({ value, settings }: CellProps<LastUpdatedValue, LastUpdatedSettings>) {
  if (!value?.updated_at) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Update aria-hidden="true" />
        </span>
      </div>
    );
  }

  const mode = settings?.mode ?? 'personAndDate';
  const isoDate = value.updated_at.slice(0, 10);
  const dateStr = formatDay(isoDate);

  return (
    <div className={styles.root}>
      <div className={styles.logCell}>
        {mode !== 'dateOnly' && value.updater_id ? (
          <UserAvatar uid={value.updater_id} size="xs" />
        ) : null}
        {mode !== 'personOnly' ? <span className={styles.logTime}>{dateStr}</span> : null}
      </div>
    </div>
  );
}

export const lastUpdatedUi = defineColumnUi<LastUpdatedValue, LastUpdatedSettings>({
  type: 'last_updated',
  icon: Update,
  tone: 'blue',
  editor: 'none',
  Cell: LastUpdatedCell,
});
