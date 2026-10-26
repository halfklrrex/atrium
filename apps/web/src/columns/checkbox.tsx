import { isChecked, type CheckboxValue } from '@atrium/shared';
import { Checkbox as CheckboxIcon } from '@vibe/icons';
import classNames from 'classnames';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckboxCell({ value, column, ctx, onChange }: CellProps<CheckboxValue, unknown>) {
  const checked = value ? isChecked(value) : false;
  return (
    <div className={styles.root}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={column.title}
        disabled={!ctx.canEdit}
        className={classNames(styles.check, checked && styles.checkOn)}
        onClick={(event) => {
          event.stopPropagation();
          onChange(checked ? null : { checked: 'true' });
        }}
      >
        {checked ? <CheckIcon /> : null}
      </button>
    </div>
  );
}

export const checkboxUi = defineColumnUi<CheckboxValue, unknown>({
  type: 'checkbox',
  icon: CheckboxIcon,
  tone: 'pink',
  // A click anywhere in the cell (or Enter on it) toggles; there is no editor to open.
  editor: 'toggle',
  Cell: CheckboxCell,
  toggle: (current) => (current && isChecked(current) ? null : { checked: 'true' }),
});
