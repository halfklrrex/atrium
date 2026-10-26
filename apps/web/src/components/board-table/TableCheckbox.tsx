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
  onChange: (next: boolean) => void;
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
      onClick={(event) => {
        event.stopPropagation();
        onChange(checked !== true);
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
