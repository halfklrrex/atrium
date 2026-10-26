import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button, TextField, Tooltip } from '@vibe/core';
import { Bold, Bullets, CheckList, Code, Italic, Link as LinkIcon, TextBig } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { showToast } from '../toast-store';
import {
  DESCRIPTION_SAVE_DELAY,
  buildDescription,
  createDebouncer,
  type DescriptionValue,
} from './description';
import { parseLinkUrl } from './link-url';
import styles from './DescriptionEditor.module.css';

export interface DescriptionEditorProps {
  /** The stored doc (ProseMirror JSON), or null when empty. */
  initial: Record<string, unknown> | null;
  readOnly: boolean;
  /** Persist the description (`null` clears it). Resolves when written. */
  onSave: (value: DescriptionValue | null) => Promise<void>;
}

type SaveState = 'idle' | 'saving' | 'saved';

interface ToolbarButton {
  label: string;
  Icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

/** Vibe has no numbered-list icon: an inline SVG that follows the text colour. */
function NumberedList() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M2.2 6V3.3l-.9.5-.3-.6 1.3-.8h.7V6zM1 9.5c0-1 .8-1.4 1.5-1.4.9 0 1.4.5 1.4 1.1 0 .5-.3.8-.9 1.3l-.5.4H4v.7H1v-.6l1.3-1.2c.4-.4.6-.5.6-.7 0-.2-.2-.3-.4-.3-.3 0-.4.2-.4.4zM1 14.800h.7c0 .2.2.4.5.4.3 0 .4-.1.4-.3 0-.2-.2-.3-.5-.3h-.3v-.6h.3c.3 0 .4-.1.4-.3 0-.2-.2-.3-.4-.3-.3 0-.4.2-.4.3H1c0-.5.5-.9 1.200-.9.7 0 1.200.4 1.200.8 0 .3-.2.5-.4.6.3.1.5.4.5.7 0 .6-.5 1-1.300 1-.8 0-1.200-.4-1.200-.9z" />
      <path d="M7 4h11v1.500H7zM7 9.250h11v1.500H7zM7 14.500h11V16H7z" />
    </svg>
  );
}

const BUTTONS: ToolbarButton[] = [
  {
    label: 'Heading',
    Icon: TextBig,
    isActive: (e) => e.isActive('heading'),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: 'Bold',
    Icon: Bold,
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: 'Italic',
    Icon: Italic,
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: 'Bulleted list',
    Icon: Bullets,
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    Icon: NumberedList,
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Checklist',
    Icon: CheckList,
    isActive: (e) => e.isActive('taskList'),
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: 'Code',
    Icon: Code,
    isActive: (e) => e.isActive('code') || e.isActive('codeBlock'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
];

/** The link form: a URL (http or https), Apply and Remove; Enter applies, Escape closes. */
function LinkPopup({
  anchor,
  editor,
  onClose,
}: {
  anchor: HTMLElement | null;
  editor: Editor;
  onClose: () => void;
}) {
  const current = (editor.getAttributes('link').href as string | undefined) ?? '';
  const [value, setValue] = useState(current);
  const [invalid, setInvalid] = useState(false);

  const finish = () => {
    onClose();
    editor.commands.focus();
  };
  const apply = () => {
    const url = parseLinkUrl(value);
    if (!url) {
      setInvalid(true);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    finish();
  };
  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    finish();
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label="Link">
      <div
        className={styles.linkPopup}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            finish();
          }
        }}
      >
        <TextField
          title="Link address"
          placeholder="https://example.com"
          value={value}
          autoFocus
          size="small"
          onChange={(next: string) => {
            setValue(next);
            setInvalid(false);
          }}
          validation={
            invalid ? { status: 'error', text: 'Enter a web address (http or https)' } : undefined
          }
        />
        <div className={styles.linkActions}>
          {current ? (
            <Button size="small" kind="tertiary" onClick={remove}>
              Remove
            </Button>
          ) : null}
          <Button size="small" onClick={apply}>
            Apply
          </Button>
        </div>
      </div>
    </AnchoredPopup>
  );
}

/**
 * The item's rich-text description (TipTap): headings, bold, italic, lists, checklists, links and
 * code. It autosaves, debounced, and shows a "Saved" hint. Loaded lazily by the item view.
 */
export default function DescriptionEditor({ initial, readOnly, onSave }: DescriptionEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });
  const debouncer = useMemo(() => createDebouncer(DESCRIPTION_SAVE_DELAY), []);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Add a description...' }),
    ],
    content: initial ?? '',
    editable: !readOnly,
    immediatelyRender: true,
    onUpdate: ({ editor: ed }) => {
      const doc = ed.getJSON() as Record<string, unknown>;
      debouncer.schedule(() => {
        const result = buildDescription(doc);
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

  return (
    <div className={styles.root}>
      {!readOnly && editor ? (
        <div className={styles.toolbar} role="toolbar" aria-label="Description formatting">
          {BUTTONS.map((b) => (
            <Tooltip key={b.label} content={b.label}>
              <button
                type="button"
                className={classNames(styles.toolButton, b.isActive(editor) && styles.toolActive)}
                aria-label={b.label}
                aria-pressed={b.isActive(editor)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => b.run(editor)}
              >
                <b.Icon aria-hidden />
              </button>
            </Tooltip>
          ))}
          <Tooltip content="Link">
            <button
              type="button"
              className={classNames(
                styles.toolButton,
                editor.isActive('link') && styles.toolActive,
              )}
              aria-label="Link"
              aria-pressed={editor.isActive('link')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => setLinkAnchor(linkAnchor ? null : event.currentTarget)}
            >
              <LinkIcon aria-hidden />
            </button>
          </Tooltip>
          <span className={styles.saveHint} role="status" aria-live="polite">
            {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : ''}
          </span>
        </div>
      ) : null}
      {linkAnchor && editor ? (
        <LinkPopup anchor={linkAnchor} editor={editor} onClose={() => setLinkAnchor(null)} />
      ) : null}
      <EditorContent editor={editor} className={styles.content} />
    </div>
  );
}
