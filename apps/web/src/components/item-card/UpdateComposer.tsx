import type { EmojiItem } from '@tiptap/extension-emoji';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { formatFileSize } from '@atrium/shared';
import { Icon, IconButton, Menu, MenuItem, SplitButton } from '@vibe/core';
import { Close, Retry } from '@vibe/icons';
import classNames from 'classnames';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
} from 'react';
import { EmojiSuggestMenu } from '../item-view/EmojiSuggest';
import { MentionController } from '../item-view/mention/mention-controller';
import { MentionMenu } from '../item-view/mention/MentionMenu';
import { SuggestController } from '../item-view/slash-menu/slash-controller';
import { TableControls } from '../item-view/TableControls';
import { ComposerInsertTools, ComposerToolbar } from './ComposerToolbar';
import { createComposerExtensions } from './composer-extensions';
import { describeCallableError } from '../../lib/callables';
import { showToast } from '../toast-store';
import {
  attachmentIcon,
  explainAttachmentRefusal,
  uploadUpdateAttachment,
  type AttachmentTarget,
} from './update-attachments';
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
  /**
   * Writes the post. A rejection keeps the text in the editor; success clears it. Resolve with the
   * new post's id to let the chosen files upload against it (see `attachTarget`).
   */
  onSubmit: (body: UpdateBody) => Promise<string | void>;
  /** Where the files of a new post (given its id) go. Without it there is no attach button. */
  attachTarget?: (postId: string) => AttachmentTarget;
}

/** A file chosen in the composer: staged until the post is written, then uploading or failed. */
interface Chip {
  key: string;
  file: File;
  status: 'staged' | 'uploading' | 'failed';
  progress: number;
  /** Set once the post exists. */
  target?: AttachmentTarget;
}

let chipCounter = 0;

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
  attachTarget,
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

  const [chips, setChips] = useState<Chip[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachTargetRef = useRef(attachTarget);
  useEffect(() => {
    attachTargetRef.current = attachTarget;
  });

  const patchChip = (key: string, patch: Partial<Chip>) =>
    setChips((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    let staged = chips.filter((c) => !c.target).length;
    const added: Chip[] = [];
    for (const file of Array.from(list)) {
      const refusal = explainAttachmentRefusal(file, staged);
      if (refusal) {
        showToast(refusal, { type: 'negative' });
        continue;
      }
      staged += 1;
      added.push({ key: `chip${chipCounter++}`, file, status: 'staged', progress: 0 });
    }
    if (added.length > 0) setChips((prev) => [...prev, ...added]);
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files);
    event.target.value = '';
  };

  const uploadChip = async (chip: Chip, target: AttachmentTarget) => {
    patchChip(chip.key, { status: 'uploading', progress: 0 });
    try {
      await uploadUpdateAttachment(target, chip.file, (progress) =>
        patchChip(chip.key, { progress }),
      );
      setChips((prev) => prev.filter((c) => c.key !== chip.key));
    } catch (error) {
      patchChip(chip.key, { status: 'failed' });
      showToast(describeCallableError(error, `Could not upload "${chip.file.name}". Try again.`), {
        type: 'negative',
      });
    }
  };

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
      .then((postId) => {
        editor.commands.clearContent(true);
        const toTarget = attachTargetRef.current;
        if (!postId || !toTarget) return;
        // The post exists now: its files upload one after another, each on its own chip.
        const target = toTarget(postId);
        const mine = chips.filter((c) => !c.target);
        if (mine.length === 0) return;
        const keys = new Set(mine.map((c) => c.key));
        setChips((prev) => prev.map((c) => (keys.has(c.key) ? { ...c, target } : c)));
        void (async () => {
          for (const chip of mine) await uploadChip(chip, target);
        })();
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
  // Chosen or still uploading files keep the box open, so a failed one can be retried.
  const open = variant === 'reply' || focused || popupOpen || !empty || chips.length > 0;
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
      {open && chips.length > 0 ? (
        <ul className={styles.attachments} aria-label="Files to attach">
          {chips.map((chip) => (
            <li
              key={chip.key}
              className={classNames(
                styles.attachment,
                chip.status === 'failed' && styles.attachmentFailed,
              )}
            >
              <Icon icon={attachmentIcon(chip.file.type)} size={16} aria-hidden />
              <span className={styles.attachmentName} title={chip.file.name}>
                {chip.file.name}
              </span>
              <span className={styles.attachmentStatus}>
                {chip.status === 'uploading'
                  ? `Uploading ${chip.progress}%`
                  : chip.status === 'failed'
                    ? 'Failed'
                    : formatFileSize(chip.file.size)}
              </span>
              {chip.status === 'failed' && chip.target ? (
                <IconButton
                  icon={Retry}
                  size="xxs"
                  kind="tertiary"
                  aria-label={`Retry ${chip.file.name}`}
                  onClick={() => void uploadChip(chip, chip.target!)}
                />
              ) : null}
              {chip.status !== 'uploading' ? (
                <IconButton
                  icon={Close}
                  size="xxs"
                  kind="tertiary"
                  aria-label={`Remove ${chip.file.name}`}
                  onClick={() => setChips((prev) => prev.filter((c) => c.key !== chip.key))}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className={styles.bottomRow}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            data-testid="composer-attach-input"
            onChange={onFileInputChange}
          />
          <ComposerInsertTools
            editor={editor}
            onPopupChange={onPopupChange}
            onAttach={attachTarget ? () => fileInputRef.current?.click() : undefined}
          />
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
