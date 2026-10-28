import {
  formatFormulaResult,
  isFormulaError,
  type FormulaSettings,
  type FormulaValue,
} from '@atrium/shared';
import { Formula } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { defineColumnUi, type CellProps } from './types';

function FormulaCell({ value, settings, ctx }: CellProps<FormulaValue, FormulaSettings>) {
  if (value === null || value === undefined || value === '') {
    return <div className={styles.root} />;
  }

  if (isFormulaError(value)) {
    return (
      <div className={styles.root}>
        <span
          className={styles.formulaError}
          title={String(value)}
          role="img"
          aria-label={`Formula error: ${String(value)}`}
        >
          !
        </span>
      </div>
    );
  }

  const formatted = formatFormulaResult(value, settings);
  if (!formatted) {
    return <div className={styles.root} />;
  }

  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={formatted} term={ctx.highlight} />
      </span>
    </div>
  );
}

export const formulaUi = defineColumnUi<FormulaValue, FormulaSettings>({
  type: 'formula',
  icon: Formula,
  tone: 'teal',
  editor: 'none',
  Cell: FormulaCell,
});
