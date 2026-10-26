import type { NumbersSettings, NumbersValue } from '@atrium/shared';
import { Numbers } from '@vibe/icons';
import { formatNumber, parseNumberInput } from './format';
import styles from './cells.module.css';
import { InlineInput } from './InlineInput';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function NumbersCell({ value, settings }: CellProps<NumbersValue, NumbersSettings>) {
  if (value === null) return <div className={styles.root} />;
  return (
    <div className={styles.root}>
      <span className={styles.text}>{formatNumber(value, settings)}</span>
    </div>
  );
}

function NumbersEditor({
  value,
  column,
  onChange,
  onClose,
}: EditorProps<NumbersValue, NumbersSettings>) {
  return (
    <InlineInput
      initial={value === null ? '' : String(value)}
      ariaLabel={column.title}
      inputMode="decimal"
      isValid={(text) => parseNumberInput(text) !== undefined}
      onCommit={(text) => {
        const parsed = parseNumberInput(text);
        if (parsed === undefined) return false;
        onChange(parsed);
      }}
      onClose={onClose}
    />
  );
}

export const numbersUi = defineColumnUi<NumbersValue, NumbersSettings>({
  type: 'numbers',
  icon: Numbers,
  tone: 'orange',
  editor: 'inline',
  Cell: NumbersCell,
  Editor: NumbersEditor,
});
