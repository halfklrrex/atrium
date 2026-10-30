import type { ButtonSettings, ButtonValue } from '@atrium/shared';
import { Button } from '@vibe/core';
import { Bolt } from '@vibe/icons';
import { useState, type CSSProperties, type MouseEvent } from 'react';
import { showToast } from '../components/toast-store';
import { columnActionCalls, describeCallableError } from '../lib/callables';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Computes a readable foreground token (dark text on bright backgrounds, light text on dark
 * backgrounds) from the hex colour's WCAG relative luminance.
 */
export function getReadableButtonTextColor(
  hex: string,
): 'var(--fixed-dark-color)' | 'var(--atrium-table-on-fill)' {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return 'var(--atrium-table-on-fill)';
  }
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  const luminance = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  return luminance > 0.5 ? 'var(--fixed-dark-color)' : 'var(--atrium-table-on-fill)';
}

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
      await columnActionCalls.clickButton({
        boardId: ctx.boardId,
        itemId: ctx.itemId,
        columnId: column.id,
      });
      showToast(`"${label}" triggered.`, { type: 'positive' });
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
