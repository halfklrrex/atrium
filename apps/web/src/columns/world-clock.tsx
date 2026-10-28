import {
  CANONICAL_TIMEZONES,
  formatWorldClockTime,
  getDefaultCity,
  type WorldClockSettings,
  type WorldClockValue,
} from '@atrium/shared';
import { Time } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { useSharedTicker } from './shared-ticker';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

interface TimezoneOption {
  tz: string;
  city: string;
  searchKey: string;
}

const TIMEZONE_OPTIONS: readonly TimezoneOption[] = Array.from(CANONICAL_TIMEZONES)
  .map((tz) => {
    const city = getDefaultCity(tz);
    return {
      tz,
      city,
      searchKey: `${city} ${tz}`.toLowerCase(),
    };
  })
  .sort((a, b) => a.city.localeCompare(b.city) || a.tz.localeCompare(b.tz));

function WorldClockCell({ value, settings, ctx }: CellProps<WorldClockValue, WorldClockSettings>) {
  const nowMs = useSharedTicker();

  if (!value?.timezone) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Time aria-hidden="true" />
        </span>
      </div>
    );
  }

  const format24Hour = settings?.format24Hour ?? true;
  const showCity = settings?.showCity ?? true;
  const timeText = formatWorldClockTime(value.timezone, new Date(nowMs), format24Hour);
  const city = getDefaultCity(value.timezone);
  const titleText = showCity ? `${timeText} (${city})` : timeText;

  return (
    <div className={styles.root}>
      <span className={styles.worldClockCell} title={titleText}>
        <span className={styles.worldClockTime}>
          <Highlight text={timeText} term={ctx.highlight} />
        </span>
        {showCity ? (
          <span className={styles.worldClockCity}>
            <Highlight text={city} term={ctx.highlight} />
          </span>
        ) : null}
      </span>
    </div>
  );
}

function WorldClockEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<WorldClockValue, WorldClockSettings>) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? TIMEZONE_OPTIONS.filter((opt) => opt.searchKey.includes(needle))
    : TIMEZONE_OPTIONS;

  const handleSelect = (tz: string) => {
    onChange({ timezone: tz });
    onClose();
  };

  const handleClear = () => {
    onChange(null);
    onClose();
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        <input
          className={popups.input}
          value={query}
          placeholder="Search timezone or city…"
          aria-label="Search timezone or city"
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={popups.list} role="listbox" aria-label="Timezone list">
          {filtered.map((opt) => {
            const isSelected = value?.timezone === opt.tz;
            return (
              <button
                key={opt.tz}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={classNames(popups.listRow, isSelected && popups.listRowOn)}
                onClick={() => handleSelect(opt.tz)}
              >
                <span>{opt.city}</span>
                <span className={popups.muted}>{opt.tz}</span>
              </button>
            );
          })}
          {filtered.length === 0 ? <p className={popups.muted}>No timezones found</p> : null}
        </div>
        <div className={popups.footer}>
          <button type="button" className={popups.linkButton} onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const worldClockUi = defineColumnUi<WorldClockValue, WorldClockSettings>({
  type: 'world_clock',
  icon: Time,
  tone: 'blue',
  editor: 'popover',
  Cell: WorldClockCell,
  Editor: WorldClockEditor,
});
