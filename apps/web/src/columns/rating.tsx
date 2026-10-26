import type { RatingSettings, RatingValue } from '@atrium/shared';
import { Favorite, Heart } from '@vibe/icons';
import classNames from 'classnames';
import { useState, type KeyboardEvent } from 'react';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function RatingCell({ value, settings, ctx, onChange }: CellProps<RatingValue, RatingSettings>) {
  const limit = settings?.limit ?? 5;
  const symbol = settings?.symbol ?? 'stars';
  const currentRating = value?.rating ?? 0;
  const Icon = symbol === 'hearts' ? Heart : Favorite;
  const activeClass =
    symbol === 'hearts' ? styles.ratingBtnActiveHeart : styles.ratingBtnActiveStar;

  return (
    <div className={styles.root}>
      <div className={styles.ratingRow} role="radiogroup" aria-label="Rating">
        {Array.from({ length: limit }, (_, i) => {
          const ratingVal = i + 1;
          const isActive = ratingVal <= currentRating;
          return (
            <button
              key={ratingVal}
              type="button"
              role="radio"
              aria-checked={currentRating === ratingVal}
              aria-label={`${ratingVal} of ${limit} ${symbol}`}
              disabled={!ctx.canEdit}
              className={classNames(styles.ratingBtn, isActive && activeClass)}
              onClick={(e) => {
                e.stopPropagation();
                if (!ctx.canEdit) return;
                const next = currentRating === ratingVal ? 0 : ratingVal;
                onChange(next > 0 ? { rating: next } : null);
              }}
            >
              <Icon className={styles.ratingIcon} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RatingEditor({
  value,
  settings,
  column,
  onChange,
  onClose,
}: EditorProps<RatingValue, RatingSettings>) {
  const limit = settings?.limit ?? 5;
  const symbol = settings?.symbol ?? 'stars';
  const currentRating = value?.rating ?? 0;
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const Icon = symbol === 'hearts' ? Heart : Favorite;
  const activeClass =
    symbol === 'hearts' ? styles.ratingBtnActiveHeart : styles.ratingBtnActiveStar;

  const handleSelect = (ratingVal: number) => {
    const next = currentRating === ratingVal ? 0 : ratingVal;
    onChange(next > 0 ? { rating: next } : null);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(limit, currentRating + 1);
      onChange({ rating: next });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(0, currentRating - 1);
      onChange(next > 0 ? { rating: next } : null);
    } else if (e.key >= '0' && e.key <= '9') {
      const num = Number(e.key);
      if (num <= limit) {
        onChange(num > 0 ? { rating: num } : null);
        onClose();
      }
    }
  };

  const activeCount = hoverRating ?? currentRating;

  return (
    <div
      className={styles.root}
      tabIndex={0}
      autoFocus
      onKeyDown={onKeyDown}
      onBlur={() => onClose()}
    >
      <div className={styles.ratingRow} role="radiogroup" aria-label={column.title}>
        {Array.from({ length: limit }, (_, i) => {
          const ratingVal = i + 1;
          const isActive = ratingVal <= activeCount;
          return (
            <button
              key={ratingVal}
              type="button"
              role="radio"
              aria-checked={currentRating === ratingVal}
              aria-label={`${ratingVal} of ${limit} ${symbol}`}
              className={classNames(styles.ratingBtn, isActive && activeClass)}
              onMouseEnter={() => setHoverRating(ratingVal)}
              onMouseLeave={() => setHoverRating(null)}
              onClick={() => handleSelect(ratingVal)}
            >
              <Icon className={styles.ratingIcon} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const ratingUi = defineColumnUi<RatingValue, RatingSettings>({
  type: 'rating',
  icon: Favorite,
  tone: 'orange',
  editor: 'inline',
  Cell: RatingCell,
  Editor: RatingEditor,
});
