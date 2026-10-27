import { useEditorState, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import styles from './DescriptionEditor.module.css';

interface TableAction {
  label: string;
  run: (editor: Editor) => void;
  danger?: boolean;
}

const ACTIONS: TableAction[] = [
  { label: 'Row above', run: (e) => e.chain().focus().addRowBefore().run() },
  { label: 'Row below', run: (e) => e.chain().focus().addRowAfter().run() },
  { label: 'Column left', run: (e) => e.chain().focus().addColumnBefore().run() },
  { label: 'Column right', run: (e) => e.chain().focus().addColumnAfter().run() },
  { label: 'Header row', run: (e) => e.chain().focus().toggleHeaderRow().run() },
  { label: 'Delete row', run: (e) => e.chain().focus().deleteRow().run(), danger: true },
  { label: 'Delete column', run: (e) => e.chain().focus().deleteColumn().run(), danger: true },
  { label: 'Delete table', run: (e) => e.chain().focus().deleteTable().run(), danger: true },
];

/**
 * A small bar that floats over the table the caret is in: add or delete rows and columns, toggle
 * the header row, delete the table. `host` is the positioned element the bar is placed inside.
 */
export function TableControls({ editor, host }: { editor: Editor; host: HTMLElement | null }) {
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => e.isActive('table') });
  const barRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!inTable || !host) return;
    const update = () => {
      const { node } = editor.view.domAtPos(editor.state.selection.from);
      const element = node instanceof Element ? node : node.parentElement;
      const table = element?.closest('table');
      if (!table) return;
      const hostRect = host.getBoundingClientRect();
      const rect = table.getBoundingClientRect();
      const barHeight = barRef.current?.offsetHeight ?? 0;
      const above = rect.top - hostRect.top - barHeight;
      // Above the table when there is room, otherwise just under it.
      const top = above >= 0 ? above : rect.bottom - hostRect.top;
      setPlace({ top, left: Math.max(0, rect.left - hostRect.left) });
    };
    update();
    editor.on('transaction', update);
    window.addEventListener('resize', update);
    return () => {
      editor.off('transaction', update);
      window.removeEventListener('resize', update);
    };
  }, [editor, host, inTable]);

  if (!inTable) return null;
  return (
    <div
      ref={barRef}
      className={styles.tableBar}
      role="toolbar"
      aria-label="Table"
      style={place ?? { visibility: 'hidden' }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          className={action.danger ? styles.tableButtonDanger : styles.tableButton}
          onClick={() => action.run(editor)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
