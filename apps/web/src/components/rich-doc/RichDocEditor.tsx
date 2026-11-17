import type { EmojiItem } from '@tiptap/extension-emoji';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '../toast-store';
import {
  IMAGE_ACCEPT,
  imageFileProblem,
  uploadDescriptionImages,
  type ImageContext,
} from '../item-view/description-image-upload';
import {
  DESCRIPTION_SAVE_DELAY,
  buildDescription,
  createDebouncer,
  type DescriptionResult,
  type DescriptionValue,
} from '../item-view/description';
import { DescriptionToolbar } from '../item-view/DescriptionToolbar';
import { ensureDocFontsLoaded } from '../item-view/editor-fonts';
import { createEditorExtensions } from '../item-view/editor-extensions';
import { EmojiPicker } from '../item-view/EmojiPicker';
import { EmojiSuggestMenu } from '../item-view/EmojiSuggest';
import { MentionController } from '../item-view/mention/mention-controller';
import { MentionMenu, type MentionSource } from '../item-view/mention/MentionMenu';
import { SlashController, SuggestController } from '../item-view/slash-menu/slash-controller';
import { SlashMenu } from '../item-view/slash-menu/SlashMenu';
import { TableControls } from '../item-view/TableControls';
import styles from '../item-view/DescriptionEditor.module.css';

export interface RichDocEditorProps {
  /** The stored doc (ProseMirror JSON), or null when empty. */
  initial: Record<string, unknown> | null;
  readOnly: boolean;
  /** Persist the content (`null` clears it). Resolves when written. */
  onSave: (value: DescriptionValue | null) => Promise<void>;
  /**
   * `'focus'` shows the formatting toolbar only while the editor has focus (or one of its popups is
   * open); `'always'`, the usual setting, keeps it on screen.
   */
  toolbar?: 'always' | 'focus';
  /**
   * Side panel: the text box stops growing at a fixed height and scrolls inside instead of
   * pushing the rest of the panel down.
   */
  scrollable?: boolean;
  /**
   * Where pasted, dropped and picked images go. Absent means images are off: no toolbar button,
   * no "/" entry and no paste or drop handling.
   */
  images?: ImageContext;
  /** Where the "@" list gets its people. Absent means no list opens. */
  mentions?: MentionSource;
  /** Turns the editor JSON into what `onSave` gets. Default: the item description rules. */
  buildValue?: (doc: Record<string, unknown>) => DescriptionResult;
  /** Empty-editor hint. */
  placeholder?: string;
  /** Called on every edit by the user (before the debounced save). */
  onEdit?: () => void;
  /**
   * New content from outside (somebody else saved): when `key` changes the editor shows `doc`
   * without triggering a save.
   */
  external?: { key: number; doc: Record<string, unknown> | null };
  /** Accessible name of the expanded dialog. */
  expandLabel?: string;
  /** Hide the expand button (a full page doesn't need it). */
  canExpand?: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved';

/**
 * The shared rich-text editor (TipTap), used by the item description and by workspace docs: headings, bold, italic, underline, strikethrough,
 * lists, checklists, links, quotes, code, dividers and tables, with markdown shortcuts and a "/"
 * block menu. It autosaves, debounced, and shows a "Saved" hint. Loaded lazily by the item view.
 *
 * Expand moves this same editor into a large dialog (a portal, so there is one editor instance
 * and one document: edits can never fork).
 */
export function RichDocEditor({
  initial,
  readOnly,
  onSave,
  toolbar = 'always',
  scrollable = false,
  images,
  mentions,
  buildValue = buildDescription,
  placeholder,
  onEdit,
  external,
  expandLabel = 'Description',
  canExpand = true,
}: RichDocEditorProps) {
  const [toolbarPopup, setToolbarPopup] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [expanded, setExpanded] = useState(false);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const onSaveRef = useRef(onSave);
  const onEditRef = useRef(onEdit);
  const buildRef = useRef(buildValue);
  useEffect(() => {
    onSaveRef.current = onSave;
    onEditRef.current = onEdit;
    buildRef.current = buildValue;
  });
  const debouncer = useMemo(() => createDebouncer(DESCRIPTION_SAVE_DELAY), []);
  const slash = useMemo(() => new SlashController(), []);
  const emojiSuggest = useMemo(() => new SuggestController<EmojiItem>(), []);
  const mentionSuggest = useMemo(() => new MentionController(), []);
  const imagesOn = images !== undefined;
  const imageBoardId = images?.boardId;
  const imageItemId = images?.itemId;
  const extensions = useMemo(
    () =>
      createEditorExtensions(slash, {
        boardId: imageBoardId,
        itemId: imageItemId,
        imagesEnabled: imagesOn,
        placeholder,
        emojiController: emojiSuggest,
        // Always wired: the extensions are built once per editor, and `readOnly` can flip from
        // true to false after mount (the board role arrives late). A read-only editor never types.
        mentionController: mentionSuggest,
      }),
    [slash, imageBoardId, imageItemId, imagesOn, placeholder, emojiSuggest, mentionSuggest],
  );
  const shellRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const editor = useEditor({
    extensions,
    content: initial ?? '',
    editable: !readOnly,
    immediatelyRender: true,
    onUpdate: ({ editor: ed }) => {
      const doc = ed.getJSON() as Record<string, unknown>;
      ensureDocFontsLoaded(doc);
      onEditRef.current?.();
      debouncer.schedule(() => {
        const result = buildRef.current(doc);
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
            if (!mounted.current) return;
            setSaveState('saved');
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => setSaveState('idle'), 2000);
          })
          .catch(() => {
            if (mounted.current) setSaveState('idle');
          });
      });
    },
    onBlur: () => debouncer.flush(),
  });

  // TipTap keeps the editor's own `editable` across renders, so a role that resolves after mount
  // (the workspace role loads after the side panel opens) must be pushed in explicitly; without
  // this the box stays read-only for good.
  useEffect(() => {
    if (editor && editor.isEditable !== !readOnly) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Leaving the window (or the item) never loses the last keystrokes.
  useEffect(() => {
    mounted.current = true;
    const flushNow = () => debouncer.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') debouncer.flush();
    };
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      debouncer.flush();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [debouncer]);

  // Content that arrives from outside (another member saved) replaces the text without a save.
  const externalKey = useRef(external?.key);
  useEffect(() => {
    if (!editor || !external || externalKey.current === external.key) return;
    externalKey.current = external.key;
    editor.commands.setContent(external.doc ?? '', { emitUpdate: false });
    if (external.doc) ensureDocFontsLoaded(external.doc);
  }, [editor, external]);

  // Viewers' editors load the fonts the doc uses.
  useEffect(() => {
    if (initial) ensureDocFontsLoaded(initial);
  }, [initial]);

  // What the "/" menu's Image and Emoji entries ask of this editor.
  useEffect(() => {
    slash.setImagesEnabled(imagesOn);
  }, [slash, imagesOn]);
  useEffect(() => {
    slash.setUi({
      pickImage: () => fileInput.current?.click(),
      openEmojiPicker: () =>
        setEmojiAnchor(shellRef.current?.querySelector<HTMLElement>('[data-tool="emoji"]') ?? null),
    });
  }, [slash]);

  const onImagesPicked = (files: FileList | null) => {
    if (!editor || !files) return;
    const picked = Array.from(files);
    const usable = picked.filter((file) => !imageFileProblem(file));
    const rejected = picked.find((file) => imageFileProblem(file));
    if (rejected) showToast(imageFileProblem(rejected)!, { type: 'negative' });
    if (usable.length > 0 && images) void uploadDescriptionImages(editor, usable, images);
  };

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
    <div
      className={expanded ? styles.rootExpanded : styles.root}
      ref={shellRef}
      data-toolbar={toolbar === 'focus' ? 'focus' : undefined}
      data-popover-open={toolbarPopup || emojiAnchor !== null ? 'true' : undefined}
      data-scrollable={scrollable && !expanded ? 'true' : undefined}
    >
      {!readOnly ? (
        <DescriptionToolbar
          editor={editor}
          expanded={expanded}
          onToggleExpand={canExpand ? () => (expanded ? collapse() : setExpanded(true)) : undefined}
          saveHint={saveHint}
          onPickImage={images ? () => fileInput.current?.click() : undefined}
          emojiOpen={emojiAnchor !== null}
          onToggleEmoji={(anchor) => setEmojiAnchor((open) => (open ? null : anchor))}
          onPopupChange={setToolbarPopup}
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
      {!readOnly ? <EmojiSuggestMenu controller={emojiSuggest} editor={editor} /> : null}
      {!readOnly && mentions ? (
        <MentionMenu controller={mentionSuggest} editor={editor} source={mentions} />
      ) : null}
      {emojiAnchor ? (
        <EmojiPicker anchor={emojiAnchor} editor={editor} onClose={() => setEmojiAnchor(null)} />
      ) : null}
      {!readOnly && images ? (
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          aria-label="Add images"
          data-testid="description-image-input"
          onChange={(event) => {
            onImagesPicked(event.target.files);
            event.target.value = '';
          }}
        />
      ) : null}
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
            aria-label={expandLabel}
          >
            {shell}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
