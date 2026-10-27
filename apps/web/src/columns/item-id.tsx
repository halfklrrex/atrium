import { formatItemId, type ItemIdSettings, type ItemIdValue } from '@atrium/shared';
import { Key } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function ItemIdCell({ value, settings, ctx }: CellProps<ItemIdValue, ItemIdSettings>) {
  if (!value) return <div className={styles.root} />;

  const formatted = formatItemId(value, settings);

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={formatted} term={ctx.highlight} />
      </span>
    </div>
  );
}

export const itemIdUi = defineColumnUi<ItemIdValue, ItemIdSettings>({
  type: 'item_id',
  icon: Key,
  tone: 'grey',
  editor: 'none',
  Cell: ItemIdCell,
});
