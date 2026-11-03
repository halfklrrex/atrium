import { useEditorState, type Editor } from '@tiptap/react';
import { Button, TextField, Tooltip } from '@vibe/core';
import {
  Bold,
  Bullets,
  CheckList,
  Emoji as EmojiIcon,
  Italic,
  Link as LinkIcon,
  Mention,
  Underline,
} from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { ColorPopup } from '../item-view/ColorPopup';
import {
  NumberedList,
  Strikethrough,
  TextColorIcon,
  type EditorIcon,
} from '../item-view/editor-icons';
import { currentColors } from '../item-view/editor-marks';
import type { ColorKey } from '../item-view/editor-palette';
import { EmojiPicker } from '../item-view/EmojiPicker';
import { parseLinkUrl } from '../item-view/link-url';
import styles from './UpdateComposer.module.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

type PopupKind = 'color' | 'emoji' | 'link';
type OpenPopup = { kind: PopupKind; anchor: HTMLElement } | null;

interface ToolProps {
  label: string;
  /** The shortcut shown in the tooltip, e.g. "Ctrl+B". */
  shortcut?: string;
  Icon: EditorIcon;
  active?: boolean;
  popup?: boolean;
  expanded?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function Tool({ label, shortcut, Icon, active, popup, expanded, onClick }: ToolProps) {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label}>
      <button
        type="button"
        className={classNames(styles.toolButton, active && styles.toolActive)}
        aria-label={label}
        aria-pressed={popup ? undefined : active}
        aria-haspopup={popup ? 'dialog' : undefined}
        aria-expanded={popup ? expanded : undefined}
        // The editor keeps the selection while a tool is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        <Icon aria-hidden />
      </button>
    </Tooltip>
  );
}

/** The link form: a web address, Apply and Remove; Enter applies, Escape closes. */
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
 * The slim formatting row of the update and reply composer: bold, italic, underline, strikethrough,
 * link, lists, checklist, colour, emoji and a button that starts an @mention. The description's
 * own toolbar is a different, much larger component and is left alone.
 */
export function ComposerToolbar({
  editor,
  onPopupChange,
}: {
  editor: Editor;
  /** Tells the composer a popup is open, so leaving the editor for it does not collapse the box. */
  onPopupChange?: (open: boolean) => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      link: e.isActive('link'),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      tasks: e.isActive('taskList'),
      textColor: currentColors(e).text,
    }),
  });
  const [popup, setPopup] = useState<OpenPopup>(null);
  // The last text colour picked, shown as the underline of the colour button.
  const [lastColor, setLastColor] = useState<ColorKey | null>(null);
  useEffect(() => onPopupChange?.(popup !== null), [popup, onPopupChange]);

  const close = () => setPopup(null);
  const toggle = (kind: PopupKind) => (event: MouseEvent<HTMLElement>) => {
    const anchor = event.currentTarget;
    setPopup((open) => (open?.kind === kind ? null : { kind, anchor }));
  };
  const chain = () => editor.chain().focus();

  // "@" opens the member list; after a word it needs a space first, like typing it would.
  const startMention = () => {
    const { from } = editor.state.selection;
    const before = from > 1 ? editor.state.doc.textBetween(from - 1, from, '\n', '\n') : '';
    const needsSpace = before !== '' && !/\s/.test(before);
    chain()
      .insertContent(needsSpace ? ' @' : '@')
      .run();
  };

  const underline = state.textColor ?? lastColor;
  const colorStyle = underline
    ? ({ '--atrium-current-color': `var(--atrium-text-${underline})` } as CSSProperties)
    : undefined;

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Text formatting">
      <Tool
        label="Bold"
        shortcut={`${MOD}B`}
        Icon={Bold}
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      />
      <Tool
        label="Italic"
        shortcut={`${MOD}I`}
        Icon={Italic}
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      />
      <Tool
        label="Underline"
        shortcut={`${MOD}U`}
        Icon={Underline}
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      />
      <Tool
        label="Strikethrough"
        shortcut={`${MOD}${SHIFT}S`}
        Icon={Strikethrough}
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      />
      <span className={styles.separator} aria-hidden="true" />
      <Tool
        label="Link"
        Icon={LinkIcon}
        active={state.link}
        popup
        expanded={popup?.kind === 'link'}
        onClick={toggle('link')}
      />
      <Tool
        label="Bulleted list"
        shortcut={`${MOD}${SHIFT}8`}
        Icon={Bullets}
        active={state.bullets}
        onClick={() => chain().toggleBulletList().run()}
      />
      <Tool
        label="Numbered list"
        shortcut={`${MOD}${SHIFT}7`}
        Icon={NumberedList}
        active={state.numbers}
        onClick={() => chain().toggleOrderedList().run()}
      />
      <Tool
        label="Checklist"
        shortcut={`${MOD}${SHIFT}9`}
        Icon={CheckList}
        active={state.tasks}
        onClick={() => chain().toggleTaskList().run()}
      />
      <span className={styles.separator} aria-hidden="true" />
      <span className={styles.colorTool} style={colorStyle}>
        <Tool
          label="Text colour and highlight"
          Icon={TextColorIcon}
          popup
          expanded={popup?.kind === 'color'}
          onClick={toggle('color')}
        />
      </span>
      <Tool
        label="Emoji"
        Icon={EmojiIcon}
        popup
        expanded={popup?.kind === 'emoji'}
        onClick={toggle('emoji')}
      />
      <Tool label="Mention someone" shortcut="@" Icon={Mention} onClick={startMention} />

      {popup?.kind === 'link' ? (
        <LinkPopup anchor={popup.anchor} editor={editor} onClose={close} />
      ) : null}
      {popup?.kind === 'color' ? (
        <ColorPopup
          anchor={popup.anchor}
          editor={editor}
          onClose={close}
          onTextColor={setLastColor}
        />
      ) : null}
      {popup?.kind === 'emoji' ? (
        <EmojiPicker anchor={popup.anchor} editor={editor} onClose={close} />
      ) : null}
    </div>
  );
}
