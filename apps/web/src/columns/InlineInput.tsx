import classNames from 'classnames';
import { useRef, useState, type KeyboardEvent } from 'react';
import styles from './cells.module.css';

interface InlineInputProps {
  initial: string;
  ariaLabel: string;
  /** Return `false` to refuse the text (it stays open and is marked invalid). */
  onCommit: (text: string) => boolean | void;
  onClose: () => void;
  inputMode?: 'text' | 'decimal';
  /** Live validity of the current text, for the red text state. */
  isValid?: (text: string) => boolean;
}

/** Cell-sized input: Enter or blur saves, Escape cancels. Used by the text and numbers columns. */
export function InlineInput({
  initial,
  ariaLabel,
  onCommit,
  onClose,
  inputMode = 'text',
  isValid,
}: InlineInputProps) {
  const [text, setText] = useState(initial);
  const done = useRef(false);

  // Enter on invalid text keeps the editor open so it can be fixed; blur and Escape just leave.
  const finish = (save: boolean, keepOpenIfInvalid = false) => {
    if (done.current) return;
    if (save && text !== initial) {
      if (onCommit(text) === false && keepOpenIfInvalid) return;
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
      className={classNames(styles.input, isValid && !isValid(text) && styles.inputInvalid)}
      value={text}
      inputMode={inputMode}
      aria-label={ariaLabel}
      autoFocus
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={onKeyDown}
    />
  );
}
