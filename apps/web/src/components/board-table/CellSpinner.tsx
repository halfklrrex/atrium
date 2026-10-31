import { Loader } from '@vibe/core';
import styles from './CellSpinner.module.css';

/** The small spinner of a cell whose column is being converted to another type. */
export function CellSpinner() {
  return (
    <span
      className={styles.spinner}
      data-testid="cell-migrating"
      role="status"
      aria-label="Converting"
    >
      <Loader size="xs" />
    </span>
  );
}
