import type { LongTextValue } from '@atrium/shared';
import { LongText } from '@vibe/icons';
import { useRef, useState, type KeyboardEvent } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { Highlight } from '../components/board-table/Highlight';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

function LongTextCell({ value, ctx }: CellProps<LongTextValue, unknown>) {
  if (!value?.text) return <div className={styles.root} />;
  return (
    <div className={`${styles.root} ${styles.start}`}>
      <span className={styles.text}>
        <Highlight text={value.text.replace(/\s*\n\s*/g, ' ')} term={ctx.highlight} />
      </span>
    </div>
  );
}

function LongTextEditor({
  value,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<LongTextValue, unknown>) {
  const [text, setText] = useState(value?.text ?? '');
  const done = useRef(false);

  const save = () => {
    if (done.current) return;
    done.current = true;
    if (text !== (value?.text ?? '')) {
      onChange(text.trim() === '' ? null : { text, changed_at: new Date().toISOString() });
    }
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={save} label={column.title}>
      <textarea
        className={popups.textarea}
        value={text}
        aria-label={column.title}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={save}
      />
    </AnchoredPopup>
  );
}

export const longTextUi = defineColumnUi<LongTextValue, unknown>({
  type: 'long_text',
  icon: LongText,
  tone: 'orange',
  editor: 'popover',
  Cell: LongTextCell,
  Editor: LongTextEditor,
});
