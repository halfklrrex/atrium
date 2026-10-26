import type { CountrySettings, CountryValue } from '@atrium/shared';
import { Country as CountryIcon } from '@vibe/icons';
import classNames from 'classnames';
import { useState } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

export function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split('')
      .map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)),
  );
}

const COMMON_COUNTRIES: readonly { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'JP', name: 'Japan' },
  { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'IL', name: 'Israel' },
  { code: 'IE', name: 'Ireland' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'SG', name: 'Singapore' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'KR', name: 'South Korea' },
  { code: 'AR', name: 'Argentina' },
];

function CountryCell({ value }: CellProps<CountryValue, CountrySettings>) {
  if (!value?.countryCode) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <CountryIcon aria-hidden="true" />
        </span>
      </div>
    );
  }

  const flag = countryFlag(value.countryCode);
  const name = value.countryName || value.countryCode;

  return (
    <div className={styles.root}>
      <span className={styles.countryCell} title={name}>
        <span className={styles.countryFlag} aria-hidden="true">
          {flag}
        </span>
        <span className={styles.countryName}>{name}</span>
      </span>
    </div>
  );
}

function CountryEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<CountryValue, CountrySettings>) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filtered = COMMON_COUNTRIES.filter(
    (c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle),
  );

  const handleSelect = (c: { code: string; name: string }) => {
    onChange({ countryCode: c.code, countryName: c.name });
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
          placeholder="Search country"
          aria-label="Search country"
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={popups.list} role="listbox" aria-label="Country list">
          {filtered.map((c) => {
            const isSelected = value?.countryCode === c.code;
            return (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={classNames(popups.listRow, isSelected && popups.listRowOn)}
                onClick={() => handleSelect(c)}
              >
                <span>{countryFlag(c.code)}</span>
                <span>{c.name}</span>
              </button>
            );
          })}
          {filtered.length === 0 ? <p className={popups.muted}>No countries found</p> : null}
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

export const countryUi = defineColumnUi<CountryValue, CountrySettings>({
  type: 'country',
  icon: CountryIcon,
  tone: 'teal',
  editor: 'popover',
  Cell: CountryCell,
  Editor: CountryEditor,
});
