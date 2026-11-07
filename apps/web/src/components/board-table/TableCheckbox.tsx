import classNames from 'classnames';
import styles from './table.module.css';

/** The small square checkbox of the table (rows and group headers). */
export function TableCheckbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean | 'mixed';
  /** `shift` is true when the click held Shift (range selection). */
  onChange: (next: boolean, modifiers: { shift: boolean }) => void;
  label: string;
  disabled?: boolean;
}) {
  const on = checked !== false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={classNames(styles.checkbox, on && styles.checkboxOn)}
      // A shift+click selects a range: keep the browser from also selecting the text in between.
      onMouseDown={(event) => {
        if (event.shiftKey) {
          event.preventDefault();
          // preventDefault also stops the focus move: put keyboard focus on this checkbox.
          event.currentTarget.focus();
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        onChange(checked !== true, { shift: event.shiftKey });
      }}
    >
      {checked === true ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : checked === 'mixed' ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 8h8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
    </button>
  );
}
