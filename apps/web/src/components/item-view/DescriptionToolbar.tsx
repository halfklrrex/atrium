import { useEditorState, type ChainedCommands, type Editor } from '@tiptap/react';
import { Button, Menu, MenuDivider, MenuItem, TextField, Tooltip } from '@vibe/core';
import {
  Bold,
  Bullets,
  Check,
  CheckList,
  Close,
  Code,
  Divider,
  Emoji as EmojiIcon,
  Fullscreen,
  Image as ImageIcon,
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
import {
  Fragment,
  type ComponentProps,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { ColorPopup } from './ColorPopup';
import { ensureFontLoaded } from './editor-fonts';
import {
  FontIcon,
  NumberedList,
  ParagraphIcon,
  Strikethrough,
  TextColorIcon,
  type EditorIcon,
} from './editor-icons';
import { currentColors, marks } from './editor-marks';
import { FONTS, type ColorKey } from './editor-palette';
import { parseLinkUrl } from './link-url';
import { toolsThatFit } from './toolbar-fit';
import styles from './DescriptionEditor.module.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';
/** A shortcut label for a tooltip: "Ctrl+B" (or the Mac symbols). */
const mod = (key: string) => `${MOD}${key}`;
const modShift = (key: string) => `${MOD}${SHIFT}${key}`;

type StyleKey = 'normal' | 'h1' | 'h2' | 'h3' | 'quote' | 'code';

/** The text-style menu: each row previews its own style (`preview` names a class). */
const TEXT_STYLES: {
  key: StyleKey;
  name: string;
  preview: 'styleNormal' | 'styleH1' | 'styleH2' | 'styleH3' | 'styleQuote' | 'styleCode';
  apply: (chain: ChainedCommands) => void;
}[] = [
  {
    key: 'normal',
    name: 'Normal text',
    preview: 'styleNormal',
    apply: (c) => c.setParagraph().run(),
  },
  {
    key: 'h1',
    name: 'Heading 1',
    preview: 'styleH1',
    apply: (c) => c.setNode('heading', { level: 1 }).run(),
  },
  {
    key: 'h2',
    name: 'Heading 2',
    preview: 'styleH2',
    apply: (c) => c.setNode('heading', { level: 2 }).run(),
  },
  {
    key: 'h3',
    name: 'Heading 3',
    preview: 'styleH3',
    apply: (c) => c.setNode('heading', { level: 3 }).run(),
  },
  { key: 'quote', name: 'Quote', preview: 'styleQuote', apply: (c) => c.toggleBlockquote().run() },
  {
    key: 'code',
    name: 'Code block',
    preview: 'styleCode',
    apply: (c) => c.toggleCodeBlock().run(),
  },
];

/** Titles in the More menu where the button's label carries a value ("Font: Default"). */
const MORE_TITLES: Record<string, string> = {
  style: 'Text style',
  font: 'Font',
};

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
      textColor: currentColors(e).text,
      font: (e.getAttributes('textStyle').fontFamily as string | null | undefined) ?? 'default',
      style: ((): StyleKey => {
        const level = ([1, 2, 3] as const).find((l) => e.isActive('heading', { level: l }));
        if (level) return `h${level}`;
        if (e.isActive('codeBlock')) return 'code';
        if (e.isActive('blockquote')) return 'quote';
        return 'normal';
      })(),
    }),
  });
}

export interface ToolButtonProps {
  label: string;
  /** Tooltip text; defaults to the label. */
  tip?: string;
  Icon: EditorIcon;
  active?: boolean;
  disabled?: boolean;
  popup?: boolean;
  /** For a button that opens a menu: whether it is open. */
  expanded?: boolean;
  /** Marks the button for the toolbar's overflow measuring. */
  fitId?: string;
  /** Marks the button for the editor shell (e.g. to anchor the emoji picker to it). */
  toolId?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function ToolButton({
  label,
  tip,
  Icon,
  active,
  disabled,
  popup,
  expanded,
  fitId,
  toolId,
  onClick,
}: ToolButtonProps) {
  return (
    <Tooltip content={tip ?? label}>
      <button
        type="button"
        className={classNames(styles.toolButton, active && styles.toolActive)}
        aria-label={label}
        aria-pressed={active}
        aria-haspopup={popup ? 'menu' : undefined}
        aria-expanded={popup ? expanded : undefined}
        data-fit={fitId}
        data-tool={toolId}
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

type PopupKind = 'style' | 'font' | 'color' | 'more' | 'link';
type OpenPopup = { kind: PopupKind; anchor: HTMLElement } | null;

interface DescriptionToolbarProps {
  editor: Editor;
  expanded: boolean;
  onToggleExpand: () => void;
  saveHint: string;
  /** Opens the file picker for an image. */
  onPickImage: () => void;
  /** Whether the emoji picker (owned by the editor shell) is open. */
  emojiOpen: boolean;
  /** Opens or closes the emoji picker, hanging it from the given button. */
  onToggleEmoji: (anchor: HTMLElement) => void;
}

/** One hideable tool: its button, and what the More menu does when it has moved in there. */
interface ToolDef {
  id: string;
  /** Tools in the same group sit together; a separator goes between groups. */
  group: number;
  button: ToolButtonProps;
  /** The same action, started from the More menu (`anchor` is the More button). */
  fromMore: (anchor: HTMLElement) => void;
  /** Wraps the button (the colour tool sets the underline colour on it). */
  wrapperStyle?: CSSProperties;
  wrapperClass?: string;
}

/** The outer width of an element in px: its box plus its horizontal margins. */
function outerWidth(el: HTMLElement): number {
  const css = getComputedStyle(el);
  return el.offsetWidth + (parseFloat(css.marginLeft) || 0) + (parseFloat(css.marginRight) || 0);
}

/**
 * The toolbar order: history, text style and font, marks and colour, lists, link, image, emoji,
 * more, then expand and the save hint. The row never wraps: tools that don't fit move into More.
 */
export function DescriptionToolbar({
  editor,
  expanded,
  onToggleExpand,
  saveHint,
  onPickImage,
  emojiOpen,
  onToggleEmoji,
}: DescriptionToolbarProps) {
  const state = useToolbarState(editor);
  const [popup, setPopup] = useState<OpenPopup>(null);
  // The last text colour picked, shown as the underline of the colour button.
  const [lastColor, setLastColor] = useState<ColorKey | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Measured widths (tool id -> outer width) and the room the row has; 0 means "not measured".
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [room, setRoom] = useState(0);
  const [gap, setGap] = useState(0);
  const close = () => setPopup(null);
  const toggle = (kind: PopupKind) => (event: MouseEvent<HTMLElement>) => {
    const anchor = event.currentTarget;
    setPopup((open) => (open?.kind === kind ? null : { kind, anchor }));
  };
  const open = (kind: PopupKind) => (anchor: HTMLElement) => setPopup({ kind, anchor });
  const chain = () => editor.chain().focus();
  const currentStyle = TEXT_STYLES.find((s) => s.key === state.style) ?? TEXT_STYLES[0]!;
  const currentFont = FONTS.find((f) => f.key === state.font) ?? FONTS[0]!;
  const underline = state.textColor ?? lastColor;
  const colorStyle = (
    underline ? { '--atrium-current-color': `var(--atrium-text-${underline})` } : undefined
  ) as CSSProperties | undefined;
  // A menu item runs its command, then closes the menu.
  const run = (command: () => void) => () => {
    command();
    close();
  };

  const tools: ToolDef[] = [
    {
      id: 'undo',
      group: 0,
      button: {
        label: 'Undo',
        tip: `Undo (${mod('Z')})`,
        Icon: Undo,
        disabled: !state.canUndo,
        onClick: () => chain().undo().run(),
      },
      fromMore: () => chain().undo().run(),
    },
    {
      id: 'redo',
      group: 0,
      button: {
        label: 'Redo',
        tip: `Redo (${modShift('Z')})`,
        Icon: Redo,
        disabled: !state.canRedo,
        onClick: () => chain().redo().run(),
      },
      fromMore: () => chain().redo().run(),
    },
    {
      id: 'style',
      group: 1,
      button: {
        label: `Text style: ${currentStyle.name}`,
        Icon: ParagraphIcon,
        popup: true,
        expanded: popup?.kind === 'style',
        onClick: toggle('style'),
      },
      fromMore: open('style'),
    },
    {
      id: 'font',
      group: 1,
      button: {
        label: `Font: ${currentFont.label}`,
        Icon: FontIcon,
        popup: true,
        expanded: popup?.kind === 'font',
        onClick: toggle('font'),
      },
      fromMore: open('font'),
    },
    {
      id: 'bold',
      group: 2,
      button: {
        label: 'Bold',
        tip: `Bold (${mod('B')})`,
        Icon: Bold,
        active: state.bold,
        onClick: () => chain().toggleBold().run(),
      },
      fromMore: () => chain().toggleBold().run(),
    },
    {
      id: 'italic',
      group: 2,
      button: {
        label: 'Italic',
        tip: `Italic (${mod('I')})`,
        Icon: Italic,
        active: state.italic,
        onClick: () => chain().toggleItalic().run(),
      },
      fromMore: () => chain().toggleItalic().run(),
    },
    {
      id: 'underline',
      group: 2,
      button: {
        label: 'Underline',
        tip: `Underline (${mod('U')})`,
        Icon: Underline,
        active: state.underline,
        onClick: () => chain().toggleUnderline().run(),
      },
      fromMore: () => chain().toggleUnderline().run(),
    },
    {
      id: 'strike',
      group: 2,
      button: {
        label: 'Strikethrough',
        tip: `Strikethrough (${modShift('S')})`,
        Icon: Strikethrough,
        active: state.strike,
        onClick: () => chain().toggleStrike().run(),
      },
      fromMore: () => chain().toggleStrike().run(),
    },
    {
      id: 'color',
      group: 2,
      button: {
        label: 'Text colour and highlight',
        Icon: TextColorIcon,
        active: Boolean(state.textColor),
        popup: true,
        onClick: toggle('color'),
      },
      fromMore: open('color'),
      wrapperStyle: colorStyle,
      wrapperClass: styles.colorButton,
    },
    {
      id: 'bullets',
      group: 3,
      button: {
        label: 'Bulleted list',
        tip: `Bulleted list (${modShift('8')})`,
        Icon: Bullets,
        active: state.bullets,
        onClick: () => chain().toggleBulletList().run(),
      },
      fromMore: () => chain().toggleBulletList().run(),
    },
    {
      id: 'numbers',
      group: 3,
      button: {
        label: 'Numbered list',
        tip: `Numbered list (${modShift('7')})`,
        Icon: NumberedList,
        active: state.numbers,
        onClick: () => chain().toggleOrderedList().run(),
      },
      fromMore: () => chain().toggleOrderedList().run(),
    },
    {
      id: 'tasks',
      group: 3,
      button: {
        label: 'Checklist',
        tip: `Checklist (${modShift('9')})`,
        Icon: CheckList,
        active: state.tasks,
        onClick: () => chain().toggleTaskList().run(),
      },
      fromMore: () => chain().toggleTaskList().run(),
    },
    {
      id: 'link',
      group: 4,
      button: { label: 'Link', Icon: LinkIcon, active: state.link, onClick: toggle('link') },
      fromMore: open('link'),
    },
    {
      id: 'image',
      group: 4,
      button: { label: 'Image', tip: 'Add an image', Icon: ImageIcon, onClick: onPickImage },
      fromMore: () => onPickImage(),
    },
    {
      id: 'emoji',
      group: 4,
      button: {
        label: 'Emoji',
        Icon: EmojiIcon,
        active: emojiOpen,
        popup: true,
        toolId: 'emoji',
        onClick: (event) => {
          close();
          onToggleEmoji(event.currentTarget);
        },
      },
      fromMore: onToggleEmoji,
    },
  ];

  // Measure each rendered tool (and the fixed parts) after every render; a tool that has moved
  // into More keeps the width it last had.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs after every render on purpose; it only sets state when a width changed, so it settles after one pass.
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    if (!bar) return;
    const next = { ...widths };
    let changed = false;
    for (const el of bar.querySelectorAll<HTMLElement>('[data-fit]')) {
      const w = outerWidth(el);
      const id = el.dataset.fit!;
      if (next[id] !== w) {
        next[id] = w;
        changed = true;
      }
    }
    if (changed) setWidths(next);
  });

  // The row's inner width, kept up to date while the panel is resized.
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    if (!bar) return;
    const measure = () => {
      const css = getComputedStyle(bar);
      const padding = (parseFloat(css.paddingLeft) || 0) + (parseFloat(css.paddingRight) || 0);
      setRoom(Math.max(0, bar.clientWidth - padding));
      setGap(parseFloat(css.columnGap) || 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const visible: Set<string> =
    room > 0
      ? toolsThatFit(
          tools.map((t) => ({ id: t.id, width: (widths[t.id] ?? 0) + gap })),
          // Fixed: More, Expand, a worst case of four separators, and the gaps around them.
          room -
            ((widths.more ?? 0) + gap) -
            ((widths.expand ?? 0) + gap) -
            4 * ((widths.separator ?? 0) + gap),
        )
      : new Set(tools.map((t) => t.id));
  const hidden = tools.filter((t) => !visible.has(t.id));
  const groups = [...new Set(tools.map((t) => t.group))];
  const moreAnchor = popup?.kind === 'more' ? popup.anchor : null;
  const fromMore = (tool: ToolDef) => () => {
    close();
    if (moreAnchor) tool.fromMore(moreAnchor);
  };

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label="Description formatting"
      ref={toolbarRef}
    >
      {groups.map((group) => {
        const shown = tools.filter((t) => t.group === group && visible.has(t.id));
        if (shown.length === 0) return null;
        const earlier = tools.some((t) => t.group < group && visible.has(t.id));
        return (
          <Fragment key={group}>
            {earlier ? (
              <span className={styles.separator} data-fit="separator" aria-hidden="true" />
            ) : null}
            {shown.map((tool) =>
              tool.wrapperClass ? (
                <span
                  key={tool.id}
                  className={tool.wrapperClass}
                  style={tool.wrapperStyle}
                  data-fit={tool.id}
                >
                  <ToolButton {...tool.button} />
                </span>
              ) : (
                <ToolButton key={tool.id} {...tool.button} fitId={tool.id} />
              ),
            )}
          </Fragment>
        );
      })}
      <ToolButton label="More" Icon={MoreActions} popup fitId="more" onClick={toggle('more')} />
      <span className={styles.spacer} />
      <span className={styles.saveHint} role="status" aria-live="polite">
        {saveHint}
      </span>
      <ToolButton
        label={expanded ? 'Close expanded view' : 'Expand'}
        tip={expanded ? 'Close expanded view (Esc)' : 'Expand'}
        Icon={expanded ? Close : Fullscreen}
        fitId="expand"
        onClick={onToggleExpand}
      />

      {popup?.kind === 'style' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="Text style">
          <div className={styles.styleList} role="menu" aria-label="Text style">
            {TEXT_STYLES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="menuitem"
                className={classNames(styles.styleOption, styles[s.preview])}
                onMouseDown={(event) => event.preventDefault()}
                onClick={run(() => s.apply(chain()))}
              >
                <span className={styles.fontCheck}>
                  {s.key === currentStyle.key ? <Check aria-hidden /> : null}
                </span>
                {s.name}
              </button>
            ))}
          </div>
        </AnchoredPopup>
      ) : null}
      {popup?.kind === 'font' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="Font">
          <div className={styles.fontList} role="menu" aria-label="Font">
            {FONTS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="menuitemradio"
                aria-checked={f.key === currentFont.key}
                className={classNames(
                  styles.fontOption,
                  f.key !== 'default' && `atrium-font-${f.key}`,
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => ensureFontLoaded(f.key)}
                onFocus={() => ensureFontLoaded(f.key)}
                onClick={run(() => marks.setFont(editor, f.key))}
              >
                <span className={styles.fontCheck}>
                  {f.key === currentFont.key ? <Check aria-hidden /> : null}
                </span>
                {f.label}
              </button>
            ))}
          </div>
        </AnchoredPopup>
      ) : null}
      {popup?.kind === 'color' ? (
        <ColorPopup
          anchor={popup.anchor}
          editor={editor}
          onClose={close}
          onTextColor={setLastColor}
        />
      ) : null}
      {popup?.kind === 'more' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="More formatting">
          <Menu id="description-more" size="medium">
            {hidden.map((tool) => (
              <MenuItem
                key={tool.id}
                title={MORE_TITLES[tool.id] ?? tool.button.label}
                icon={tool.button.Icon as ComponentProps<typeof MenuItem>['icon']}
                disabled={tool.button.disabled}
                onClick={fromMore(tool)}
              />
            ))}
            {hidden.length > 0 ? <MenuDivider /> : null}
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
