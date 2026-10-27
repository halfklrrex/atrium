import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '../toast-store';
import {
  DESCRIPTION_SAVE_DELAY,
  buildDescription,
  createDebouncer,
  type DescriptionValue,
} from './description';
import { DescriptionToolbar } from './DescriptionToolbar';
import { createEditorExtensions } from './editor-extensions';
import { SlashController } from './slash-menu/slash-controller';
import { SlashMenu } from './slash-menu/SlashMenu';
import { TableControls } from './TableControls';
import styles from './DescriptionEditor.module.css';

export interface DescriptionEditorProps {
  /** The stored doc (ProseMirror JSON), or null when empty. */
  initial: Record<string, unknown> | null;
  readOnly: boolean;
  /** Persist the description (`null` clears it). Resolves when written. */
  onSave: (value: DescriptionValue | null) => Promise<void>;
}

type SaveState = 'idle' | 'saving' | 'saved';

/**
 * The item's rich-text description (TipTap): headings, bold, italic, underline, strikethrough,
 * lists, checklists, links, quotes, code, dividers and tables, with markdown shortcuts and a "/"
 * block menu. It autosaves, debounced, and shows a "Saved" hint. Loaded lazily by the item view.
 *
 * Expand moves this same editor into a large dialog (a portal, so there is one editor instance
 * and one document: edits can never fork).
 */
export default function DescriptionEditor({ initial, readOnly, onSave }: DescriptionEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [expanded, setExpanded] = useState(false);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });
  const debouncer = useMemo(() => createDebouncer(DESCRIPTION_SAVE_DELAY), []);
  const slash = useMemo(() => new SlashController(), []);
  const extensions = useMemo(() => createEditorExtensions(slash), [slash]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions,
    content: initial ?? '',
    editable: !readOnly,
    immediatelyRender: true,
    onUpdate: ({ editor: ed }) => {
      const doc = ed.getJSON() as Record<string, unknown>;
      debouncer.schedule(() => {
        const result = buildDescription(doc);
        // Over the size limit: tell the user and keep the editor as it is. The next edit
        // schedules a fresh save, so shortening the text saves again.
        if (!result.ok) {
          showToast(result.message, { type: 'negative' });
          return;
        }
        setSaveState('saving');
        onSaveRef
          .current(result.value)
          .then(() => {
            setSaveState('saved');
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => setSaveState('idle'), 2000);
          })
          .catch(() => setSaveState('idle'));
      });
    },
    onBlur: () => debouncer.flush(),
  });

  // Leaving the window (or the item) never loses the last keystrokes.
  useEffect(
    () => () => {
      debouncer.flush();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [debouncer],
  );

  const collapse = useCallback(() => {
    setExpanded(false);
    debouncer.flush();
  }, [debouncer]);

  // Escape returns to the inline view, unless a menu or the "/" plugin already handled it.
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        collapse();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded, collapse]);

  // Expanding or collapsing re-parents the editor element: give it the caret back.
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (editor && !readOnly && wasExpanded.current !== expanded) editor.commands.focus();
    wasExpanded.current = expanded;
  }, [editor, expanded, readOnly]);

  if (!editor) return null;

  const saveHint = saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : '';

  const shell = (
    <div className={expanded ? styles.rootExpanded : styles.root}>
      {!readOnly ? (
        <DescriptionToolbar
          editor={editor}
          expanded={expanded}
          onToggleExpand={() => (expanded ? collapse() : setExpanded(true))}
          saveHint={saveHint}
        />
      ) : null}
      <div
        className={expanded ? styles.contentHostExpanded : styles.contentHost}
        ref={setContentHost}
      >
        <EditorContent editor={editor} className={styles.content} />
        {!readOnly ? <TableControls editor={editor} host={contentHost} /> : null}
      </div>
      {!readOnly ? <SlashMenu controller={slash} editor={editor} /> : null}
    </div>
  );

  if (!expanded) return shell;
  return (
    <>
      <div className={styles.expandedPlaceholder} />
      {createPortal(
        <div className={styles.expandOverlay}>
          <button
            type="button"
            className={styles.expandScrim}
            aria-label="Close expanded view"
            tabIndex={-1}
            onClick={collapse}
          />
          <div
            className={styles.expandWindow}
            role="dialog"
            aria-modal="true"
            aria-label="Description"
          >
            {shell}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
