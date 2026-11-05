import type { EmojiItem } from '@tiptap/extension-emoji';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Menu, MenuItem, SplitButton } from '@vibe/core';
import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { EmojiSuggestMenu } from '../item-view/EmojiSuggest';
import { MentionController } from '../item-view/mention/mention-controller';
import { MentionMenu } from '../item-view/mention/MentionMenu';
import { SuggestController } from '../item-view/slash-menu/slash-controller';
import { TableControls } from '../item-view/TableControls';
import { ComposerInsertTools, ComposerToolbar } from './ComposerToolbar';
import { createComposerExtensions } from './composer-extensions';
import { buildUpdateBody, type UpdateBody } from './update-doc';
import styles from './UpdateComposer.module.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface UpdateComposerProps {
  boardId: string;
  placeholder: string;
  /** An update starts as one line and opens on focus; a reply is open from the start. */
  variant: 'update' | 'reply';
  /** Put the caret in the editor on mount. */
  autoFocus?: boolean;
  /** The button's label ("Update" or "Reply"). */
  submitLabel: string;
  /** Writes the post. A rejection keeps the text in the editor; success clears it. */
  onSubmit: (body: UpdateBody) => Promise<void>;
}

/**
 * The rich-text box for an update or a reply (TipTap): the subset of the description editor in
 * `createComposerExtensions`, a formatting toolbar, a bottom row (@, emoji, split Update button), Ctrl/Cmd+Enter to post (Enter is a new line or list
 * item). It is loaded lazily, and a reply only mounts it once its reply box is opened.
 */
export default function UpdateComposer({
  boardId,
  placeholder,
  variant,
  autoFocus = false,
  submitLabel,
  onSubmit,
}: UpdateComposerProps) {
  const [focused, setFocused] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  // The scroll box of the editor: the table controls hang from it.
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const submitRef = useRef<() => void>(() => undefined);
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  const emojiSuggest = useMemo(() => new SuggestController<EmojiItem>(), []);
  const mentionSuggest = useMemo(() => new MentionController(), []);
  const extensions = useMemo(
    () =>
      createComposerExtensions({
        emojiController: emojiSuggest,
        mentionController: mentionSuggest,
        placeholder,
      }),
    [emojiSuggest, mentionSuggest, placeholder],
  );

  const editor = useEditor({
    extensions,
    content: '',
    immediatelyRender: true,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submitRef.current();
          return true;
        }
        return false;
      },
    },
  });

  const empty = useEditorState({
    editor,
    // Same test as the post itself, so a lone divider (no text) keeps the button disabled.
    selector: ({ editor: e }) =>
      e ? buildUpdateBody(e.getJSON() as Record<string, unknown>) === null : true,
  });

  const submit = () => {
    if (!editor || submittingRef.current) return;
    const body = buildUpdateBody(editor.getJSON() as Record<string, unknown>);
    if (!body) return;
    submittingRef.current = true;
    setSubmitting(true);
    onSubmitRef
      .current(body)
      .then(() => {
        editor.commands.clearContent(true);
      })
      .catch((error: unknown) => {
        console.error(`Failed to post ${variant}`, error);
      })
      .finally(() => {
        submittingRef.current = false;
        setSubmitting(false);
      });
  };

  useEffect(() => {
    submitRef.current = submit;
  });

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  };
  const onPopupChange = useCallback((open: boolean) => setPopupOpen(open), []);

  if (!editor) return null;
  const open = variant === 'reply' || focused || popupOpen || !empty;
  const shortcut = IS_MAC ? '⌘+Enter' : 'Ctrl+Enter';

  return (
    <div
      className={classNames(
        styles.composerBox,
        variant === 'reply' && styles.reply,
        focused && styles.composerBoxFocused,
      )}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      {open ? <ComposerToolbar editor={editor} onPopupChange={onPopupChange} /> : null}
      <div
        ref={setContentHost}
        className={classNames(styles.content, open && styles.contentExpanded)}
      >
        <EditorContent editor={editor} />
        {open ? <TableControls editor={editor} host={contentHost} /> : null}
      </div>
      {open ? (
        <div className={styles.bottomRow}>
          <ComposerInsertTools editor={editor} onPopupChange={onPopupChange} />
          <SplitButton
            size="small"
            disabled={empty || submitting}
            loading={submitting}
            onClick={submit}
            secondaryDialogContent={
              <Menu id="composer-post-menu" size="medium">
                <MenuItem title={`${submitLabel} (${shortcut})`} onClick={submit} />
              </Menu>
            }
            shouldCloseOnClickInsideDialog
          >
            {submitLabel}
          </SplitButton>
        </div>
      ) : null}
      <EmojiSuggestMenu controller={emojiSuggest} editor={editor} />
      <MentionMenu controller={mentionSuggest} editor={editor} boardId={boardId} />
    </div>
  );
}
