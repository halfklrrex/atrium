import { columnRegistry } from '@atrium/shared';
import { Button } from '@vibe/core';
import { useState } from 'react';
import { Popover } from '../Popover';
import type { LegendEntry } from './date-view-model';
import styles from './date-views.module.css';

/** The colour legend under a date view: a dot and a name per group, or per status label. */
export function ColorLegend({ entries }: { entries: readonly LegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ul className={styles.legend} aria-label="Legend">
      {entries.map((entry) => (
        <li key={entry.key} className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ background: entry.color }}
            aria-hidden="true"
          />
          {entry.name}
        </li>
      ))}
    </ul>
  );
}

export interface DateViewEmptyProps {
  /** Editors get an "Add column" menu. */
  canEdit: boolean;
  onAddColumn: (type: 'date' | 'timeline') => void;
}

/** What a Calendar or Timeline shows when the board has no date or timeline column. */
export function DateViewEmpty({ canEdit, onAddColumn }: DateViewEmptyProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.empty}>
      <p className={styles.emptyText}>Add a date or timeline column to use this view</p>
      {canEdit ? (
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          label="Add column"
          trigger={
            <Button size="small" onClick={() => setOpen((v) => !v)}>
              Add column
            </Button>
          }
        >
          <div className={styles.addColumnMenu}>
            {(['date', 'timeline'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onAddColumn(type);
                }}
              >
                {columnRegistry.get(type).label}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
