import type { ButtonSettings, ButtonValue } from '@atrium/shared';
import { Button } from '@vibe/core';
import { Bolt } from '@vibe/icons';
import { useState, type CSSProperties, type MouseEvent } from 'react';
import { showToast } from '../components/toast-store';
import { columnActionCalls, describeCallableError } from '../lib/callables';
import styles from './cells.module.css';
import { getReadableTextColor } from './label-color';
import { defineColumnUi, type CellProps } from './types';

/**
 * Computes a readable foreground token (dark text on bright backgrounds, light text on dark
 * backgrounds) from the hex color's WCAG relative luminance.
 */
export const getReadableButtonTextColor = getReadableTextColor;

function ButtonCell({ settings, column, ctx }: CellProps<ButtonValue, ButtonSettings>) {
  const [busy, setBusy] = useState(false);
  const label = settings?.label || 'Click';
  const fg = settings?.color
    ? getReadableButtonTextColor(settings.color)
    : 'var(--atrium-table-on-fill)';
  const canAct = ctx.canAct ?? ctx.canEdit;

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (busy || !canAct || !ctx.boardId || !ctx.itemId) return;
    setBusy(true);
    try {
      const result = await columnActionCalls.clickButton({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
      });
      const ran = result.applied.length;
      showToast(
        ran > 0 ? `Done: ${ran} ${ran === 1 ? 'action' : 'actions'} ran` : `"${label}" triggered.`,
        { type: 'positive' },
      );
    } catch (err) {
      showToast(describeCallableError(err, 'Could not trigger button.'), { type: 'negative' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.root}>
      <Button
        size="small"
        className={styles.customButton}
        disabled={!canAct}
        loading={busy}
        style={
          {
            '--atrium-btn-bg': settings?.color || 'var(--primary-color)',
            '--atrium-btn-fg': fg,
          } as CSSProperties
        }
        onClick={(event) => void handleClick(event)}
      >
        {label}
      </Button>
    </div>
  );
}

export const buttonUi = defineColumnUi<ButtonValue, ButtonSettings>({
  type: 'button',
  icon: Bolt,
  tone: 'purple',
  editor: 'none',
  Cell: ButtonCell,
});
