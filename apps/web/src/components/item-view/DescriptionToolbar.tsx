import { useEditorState, type Editor } from '@tiptap/react';
import { Button, Menu, MenuDivider, MenuItem, TextField, Tooltip } from '@vibe/core';
import {
  Bold,
  Bullets,
  Check,
  CheckList,
  Close,
  Code,
  Divider,
  DropdownChevronDown,
  Fullscreen,
  Italic,
  Link as LinkIcon,
  MoreActions,
  Quote,
  Redo,
  Table,
  Underline,
  Undo,
} from '@vibe/icons';
import classNames from 'classnames';
import { useState, type MouseEvent } from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { NumberedList, Strikethrough, type EditorIcon } from './editor-icons';
import { parseLinkUrl } from './link-url';
import styles from './DescriptionEditor.module.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';
/** A shortcut label for a tooltip: "Ctrl+B" (or the Mac symbols). */
const mod = (key: string) => `${MOD}${key}`;
const modShift = (key: string) => `${MOD}${SHIFT}${key}`;

const TEXT_STYLES: { name: string; level: 0 | 1 | 2 | 3 }[] = [
  { name: 'Normal text', level: 0 },
  { name: 'Heading 1', level: 1 },
  { name: 'Heading 2', level: 2 },
  { name: 'Heading 3', level: 3 },
];

function useToolbarState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      tasks: e.isActive('taskList'),
      link: e.isActive('link'),
      style: ([1, 2, 3] as const).find((l) => e.isActive('heading', { level: l })) ?? 0,
    }),
  });
}

interface ToolButtonProps {
  label: string;
  /** Tooltip text; defaults to the label. */
  tip?: string;
  Icon: EditorIcon;
  active?: boolean;
  disabled?: boolean;
  popup?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function ToolButton({ label, tip, Icon, active, disabled, popup, onClick }: ToolButtonProps) {
  return (
    <Tooltip content={tip ?? label}>
      <button
        type="button"
        className={classNames(styles.toolButton, active && styles.toolActive)}
        aria-label={label}
        aria-pressed={active}
        aria-haspopup={popup ? 'menu' : undefined}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        <Icon aria-hidden />
      </button>
    </Tooltip>
  );
}

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

type PopupKind = 'style' | 'more' | 'link';
type OpenPopup = { kind: PopupKind; anchor: HTMLElement } | null;

interface DescriptionToolbarProps {
  editor: Editor;
  expanded: boolean;
  onToggleExpand: () => void;
  saveHint: string;
}

/** monday's toolbar order: history, text style, marks, lists, link, more, then expand and the save hint. */
export function DescriptionToolbar({
  editor,
  expanded,
  onToggleExpand,
  saveHint,
}: DescriptionToolbarProps) {
  const state = useToolbarState(editor);
  const [popup, setPopup] = useState<OpenPopup>(null);
  const close = () => setPopup(null);
  const toggle = (kind: PopupKind) => (event: MouseEvent<HTMLElement>) => {
    const anchor = event.currentTarget;
    setPopup((open) => (open?.kind === kind ? null : { kind, anchor }));
  };
  const chain = () => editor.chain().focus();
  const currentStyle = TEXT_STYLES.find((s) => s.level === state.style) ?? TEXT_STYLES[0]!;
  // A menu item runs its command, then closes the menu.
  const run = (command: () => void) => () => {
    command();
    close();
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Description formatting">
      <ToolButton
        label="Undo"
        tip={`Undo (${mod('Z')})`}
        Icon={Undo}
        disabled={!state.canUndo}
        onClick={() => chain().undo().run()}
      />
      <ToolButton
        label="Redo"
        tip={`Redo (${modShift('Z')})`}
        Icon={Redo}
        disabled={!state.canRedo}
        onClick={() => chain().redo().run()}
      />
      <span className={styles.separator} aria-hidden="true" />
      <Tooltip content="Text style">
        <button
          type="button"
          className={styles.styleButton}
          aria-label="Text style"
          aria-haspopup="menu"
          aria-expanded={popup?.kind === 'style'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggle('style')}
        >
          <span>{currentStyle.name}</span>
          <DropdownChevronDown aria-hidden />
        </button>
      </Tooltip>
      <span className={styles.separator} aria-hidden="true" />
      <ToolButton
        label="Bold"
        tip={`Bold (${mod('B')})`}
        Icon={Bold}
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      />
      <ToolButton
        label="Italic"
        tip={`Italic (${mod('I')})`}
        Icon={Italic}
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      />
      <ToolButton
        label="Underline"
        tip={`Underline (${mod('U')})`}
        Icon={Underline}
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      />
      <ToolButton
        label="Strikethrough"
        tip={`Strikethrough (${modShift('S')})`}
        Icon={Strikethrough}
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      />
      <span className={styles.separator} aria-hidden="true" />
      <ToolButton
        label="Bulleted list"
        tip={`Bulleted list (${modShift('8')})`}
        Icon={Bullets}
        active={state.bullets}
        onClick={() => chain().toggleBulletList().run()}
      />
      <ToolButton
        label="Numbered list"
        tip={`Numbered list (${modShift('7')})`}
        Icon={NumberedList}
        active={state.numbers}
        onClick={() => chain().toggleOrderedList().run()}
      />
      <ToolButton
        label="Checklist"
        tip={`Checklist (${modShift('9')})`}
        Icon={CheckList}
        active={state.tasks}
        onClick={() => chain().toggleTaskList().run()}
      />
      <span className={styles.separator} aria-hidden="true" />
      <ToolButton label="Link" Icon={LinkIcon} active={state.link} onClick={toggle('link')} />
      <ToolButton label="More" Icon={MoreActions} popup onClick={toggle('more')} />
      <span className={styles.spacer} />
      <span className={styles.saveHint} role="status" aria-live="polite">
        {saveHint}
      </span>
      <ToolButton
        label={expanded ? 'Close expanded view' : 'Expand'}
        tip={expanded ? 'Close expanded view (Esc)' : 'Expand'}
        Icon={expanded ? Close : Fullscreen}
        onClick={onToggleExpand}
      />

      {popup?.kind === 'style' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="Text style">
          <Menu id="description-text-style" size="medium">
            {TEXT_STYLES.map((s) => (
              <MenuItem
                key={s.name}
                title={s.name}
                icon={s.level === state.style ? Check : undefined}
                onClick={run(() =>
                  s.level === 0
                    ? chain().setParagraph().run()
                    : chain().setNode('heading', { level: s.level }).run(),
                )}
              />
            ))}
          </Menu>
        </AnchoredPopup>
      ) : null}
      {popup?.kind === 'more' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="More formatting">
          <Menu id="description-more" size="medium">
            <MenuItem
              title="Quote"
              icon={Quote}
              onClick={run(() => chain().toggleBlockquote().run())}
            />
            <MenuItem
              title="Code block"
              icon={Code}
              onClick={run(() => chain().toggleCodeBlock().run())}
            />
            <MenuItem
              title="Inline code"
              icon={Code}
              onClick={run(() => chain().toggleCode().run())}
            />
            <MenuItem
              title="Divider"
              icon={Divider}
              onClick={run(() => chain().setHorizontalRule().run())}
            />
            <MenuItem
              title="Table"
              icon={Table}
              onClick={run(() =>
                chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
              )}
            />
            <MenuDivider />
            <MenuItem
              title="Clear formatting"
              onClick={run(() => chain().unsetAllMarks().clearNodes().run())}
            />
          </Menu>
        </AnchoredPopup>
      ) : null}
      {popup?.kind === 'link' ? (
        <LinkPopup anchor={popup.anchor} editor={editor} onClose={close} />
      ) : null}
    </div>
  );
}
