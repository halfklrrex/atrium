import { Text as TextIcon } from '@vibe/icons';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import { InlineInput } from './InlineInput';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function TextCell({ value, ctx }: CellProps<string, unknown>) {
  if (!value) return <div className={styles.root} />;
  return (
    <div className={styles.root}>
      <span className={styles.text}>
        <Highlight text={value} term={ctx.highlight} />
      </span>
    </div>
  );
}

function TextEditor({ value, column, onChange, onClose }: EditorProps<string, unknown>) {
  return (
    <InlineInput
      initial={value ?? ''}
      ariaLabel={column.title}
      onCommit={(text) => onChange(text.trim() === '' ? null : text)}
      onClose={onClose}
    />
  );
}

export const textUi = defineColumnUi<string, unknown>({
  type: 'text',
  icon: TextIcon,
  tone: 'orange',
  editor: 'inline',
  Cell: TextCell,
  Editor: TextEditor,
});
