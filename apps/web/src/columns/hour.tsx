import { formatHour, parseHour, type HourSettings, type HourValue } from '@atrium/shared';
import { Time } from '@vibe/icons';
import classNames from 'classnames';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function HourCell({ value, settings, ctx }: CellProps<HourValue, HourSettings>) {
  if (!value) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <Time aria-hidden="true" />
        </span>
      </div>
    );
  }

  const text = formatHour(value, settings?.format24Hour ?? true);

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={text} term={ctx.highlight} />
      </span>
    </div>
  );
}

function isHourInputValid(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || parseHour(trimmed) !== null;
}

function HourEditor({
  value,
  settings,
  column,
  onChange,
  onClose,
}: EditorProps<HourValue, HourSettings>) {
  const format24Hour = settings?.format24Hour ?? true;
  const initial = value ? formatHour(value, format24Hour) : '';
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const valid = isHourInputValid(text);

  const commit = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onChange(null);
      return true;
    }
    const parsed = parseHour(trimmed);
    if (!parsed) return false;
    onChange(parsed);
    return true;
  };

  const finish = (save: boolean, keepOpenIfInvalid = false) => {
    if (done.current) return;
    if (save && (text !== initial || keepOpenIfInvalid)) {
      if (!commit(text) && keepOpenIfInvalid) return;
    }
    done.current = true;
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  };

  return (
    <input
      className={classNames(styles.input, !valid && styles.inputInvalid)}
      value={text}
      inputMode="text"
      aria-label={column.title}
      aria-invalid={!valid}
      placeholder={format24Hour ? '09:30' : '09:30 AM'}
      title={!valid ? 'Enter a valid time (e.g. 14:30 or 2:30 PM)' : undefined}
      autoFocus
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={onKeyDown}
    />
  );
}

export const hourUi = defineColumnUi<HourValue, HourSettings>({
  type: 'hour',
  icon: Time,
  tone: 'teal',
  editor: 'inline',
  Cell: HourCell,
  Editor: HourEditor,
});
