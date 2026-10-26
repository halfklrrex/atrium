import type { CreationLogSettings, CreationLogValue } from '@atrium/shared';
import { Time } from '@vibe/icons';
import { UserAvatar } from '../components/UserAvatar';
import styles from './cells.module.css';
import { formatDay } from './format';
import { defineColumnUi, type CellProps } from './types';

function CreationLogCell({ value, settings }: CellProps<CreationLogValue, CreationLogSettings>) {
  if (!value?.created_at) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Time aria-hidden="true" />
        </span>
      </div>
    );
  }

  const mode = settings?.mode ?? 'personAndDate';
  const isoDate = value.created_at.slice(0, 10);
  const dateStr = formatDay(isoDate);

  return (
    <div className={styles.root}>
      <div className={styles.logCell}>
        {mode !== 'dateOnly' && value.creator_id ? (
          <UserAvatar uid={value.creator_id} size="xs" />
        ) : null}
        {mode !== 'personOnly' ? <span className={styles.logTime}>{dateStr}</span> : null}
      </div>
    </div>
  );
}

export const creationLogUi = defineColumnUi<CreationLogValue, CreationLogSettings>({
  type: 'creation_log',
  icon: Time,
  tone: 'blue',
  editor: 'none',
  Cell: CreationLogCell,
});
