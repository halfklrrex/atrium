import type { GroupDef } from '@atrium/shared';
import { useState, type CSSProperties } from 'react';
import type { ItemDoc } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import { useTableStore } from './table-store';
import { TableCheckbox } from './TableCheckbox';
import classNames from 'classnames';
import styles from './table.module.css';

/**
 * "+ Add item": click to type a name; Enter adds it at the bottom of the group and keeps the input
 * open for the next one; Escape (or leaving it empty) closes it.
 */
export function AddItemRow({
  group,
  items,
  disabled = false,
  parent,
}: {
  group: GroupDef;
  items: readonly ItemDoc[];
  disabled?: boolean;
  /** Adds subitems of this item instead of items of the group. */
  parent?: ItemDoc;
}) {
  const env = useTableEnv();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // Items added through this row, so rapid Enter presses stack in order before the snapshot lands.
  const endMarker = useTableStore(
    (s) => s.dropMarker?.groupId === group.id && s.dropMarker.itemId === null,
  );
  const [added, setAdded] = useState<readonly { id: string; position: string }[]>([]);

  if (disabled) return null;

  const add = async () => {
    const name = text.trim();
    if (!name) return;
    setText('');
    const position = positionAfterAll([...items, ...added]);
    setAdded((list) => [...list, { id: `pending-${list.length}`, position }]);
    if (parent) await tableActions.addSubitem(env.ctx, parent, { position, name });
    else await tableActions.addItem(env.ctx, { groupId: group.id, position, name });
  };

  const close = () => {
    setOpen(false);
    setText('');
    setAdded([]);
  };

  return (
    <div
      role="row"
      className={classNames(styles.addRow, endMarker && styles.dropBefore)}
      style={{ '--group-color': group.color } as CSSProperties}
    >
      <div className={classNames(styles.sticky, styles.tinted)}>
        <span className={classNames(styles.bar, styles.barFaded)} />
        <div className={styles.checkCell} role="gridcell">
          <TableCheckbox checked={false} disabled label="Select" onChange={() => undefined} />
        </div>
        <div className={styles.addName} role="gridcell">
          {open && env.canEdit ? (
            <input
              className={styles.addInput}
              value={text}
              aria-label={parent ? `New subitem of ${parent.name}` : `New item in ${group.title}`}
              placeholder={parent ? 'Subitem name' : 'Item name'}
              autoFocus
              maxLength={500}
              onChange={(event) => setText(event.target.value)}
              onBlur={() => {
                if (text.trim()) void add();
                close();
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void add();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.addButton}
              disabled={!env.canEdit}
              onClick={() => setOpen(true)}
            >
              {parent ? '+ Add subitem' : '+ Add item'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
