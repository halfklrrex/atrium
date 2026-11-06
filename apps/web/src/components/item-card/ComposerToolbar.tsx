import { useEditorState, type Editor } from '@tiptap/react';
import { Button, Menu, MenuItem, TextField, Tooltip } from '@vibe/core';
import {
  AlignCenter,
  Attach,
  AlignLeft,
  AlignRight,
  Bold,
  Bullets,
  Check,
  CheckList,
  Divider,
  Emoji as EmojiIcon,
  Italic,
  Link as LinkIcon,
  Mention,
  MoreActions,
  Table,
  TextBig,
  Underline,
} from '@vibe/icons';
import classNames from 'classnames';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { ColorPopup } from '../item-view/ColorPopup';
import descriptionStyles from '../item-view/DescriptionEditor.module.css';
import {
  DirectionIcon,
  NumberedList,
  ParagraphIcon,
  Strikethrough,
  TextColorIcon,
  type EditorIcon,
} from '../item-view/editor-icons';
import { currentColors } from '../item-view/editor-marks';
import type { ColorKey } from '../item-view/editor-palette';
import { EmojiPicker } from '../item-view/EmojiPicker';
import { parseLinkUrl } from '../item-view/link-url';
import { TEXT_STYLES, type StyleKey } from '../item-view/text-styles';
import { toolsThatFit } from '../item-view/toolbar-fit';
import {
  composerMarks,
  currentAlign,
  currentDir,
  currentFontSize,
  type AlignKey,
} from './composer-marks';
import styles from './UpdateComposer.module.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

type PopupKind = 'style' | 'size' | 'align' | 'color' | 'link' | 'more' | 'emoji';
type OpenPopup = { kind: PopupKind; anchor: HTMLElement } | null;

interface ToolProps {
  label: string;
  /** The shortcut shown in the tooltip, e.g. "Ctrl+B". */
  shortcut?: string;
  Icon: EditorIcon;
  active?: boolean;
  popup?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  /** Marks the button for the toolbar's overflow measuring and roving focus. */
  fitId?: string;
  /** False takes the button out of the tab order (roving focus). */
  tabStop?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function Tool({
  label,
  shortcut,
  Icon,
  active,
  popup,
  expanded,
  disabled,
  fitId,
  tabStop,
  onClick,
}: ToolProps) {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label}>
      <button
        type="button"
        className={classNames(styles.toolButton, active && styles.toolActive)}
        aria-label={label}
        aria-pressed={popup ? undefined : active}
        aria-haspopup={popup ? 'menu' : undefined}
        aria-expanded={popup ? expanded : undefined}
        data-fit={fitId}
        data-roving={fitId}
        disabled={disabled}
        tabIndex={fitId === undefined || tabStop ? undefined : -1}
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

/** The order the toolbar gives tools up when the row is too narrow: first to go is the direction. */
const COMPOSER_HIDE_ORDER = [
  'dir',
  'tasks',
  'divider',
  'align',
  'table',
  'link',
  'size',
  'numbers',
  'bullets',
  'color',
  'strike',
  'underline',
  'style',
  'italic',
  'bold',
];

/** The ¶ menu of the composer: monday's four rows, in its order. */
const STYLE_ORDER: StyleKey[] = ['normal', 'quote', 'code', 'h2'];
const COMPOSER_STYLE_NAMES: Partial<Record<StyleKey, string>> = { code: 'Code', h2: 'Header' };
const COMPOSER_STYLES = STYLE_ORDER.map((key) => {
  const style = TEXT_STYLES.find((s) => s.key === key)!;
  return { ...style, name: COMPOSER_STYLE_NAMES[key] ?? style.name };
});

const SIZES = [
  { key: 'small', name: 'Small' },
  { key: 'normal', name: 'Normal' },
  { key: 'large', name: 'Large' },
  { key: 'huge', name: 'Huge' },
] as const;

const ALIGNS: { key: AlignKey; name: string; Icon: EditorIcon }[] = [
  { key: 'left', name: 'Align left', Icon: AlignLeft },
  { key: 'center', name: 'Align centre', Icon: AlignCenter },
  { key: 'right', name: 'Align right', Icon: AlignRight },
];

/** One hideable tool: its button, and what the More menu does when it has moved in there. */
interface ToolDef {
  id: string;
  button: ToolProps;
  /** The same action, started from the More menu (`anchor` is the More button). */
  fromMore: (anchor: HTMLElement) => void;
  /** Wraps the button (the colour tool sets the underline colour on it). */
  wrapperStyle?: CSSProperties;
}

/** The outer width of an element in px: its box plus its horizontal margins. */
function outerWidth(el: HTMLElement): number {
  const css = getComputedStyle(el);
  return el.offsetWidth + (parseFloat(css.marginLeft) || 0) + (parseFloat(css.marginRight) || 0);
}

/**
 * The formatting row of the update and reply composer, in monday's order: text style, bold,
 * italic, underline, strikethrough, colour, size, numbers, bullets, table, link, alignment,
 * divider, direction, checklist. Icon-only, one tab stop (arrow keys move between buttons), and
 * it never wraps: tools that do not fit move into a More menu. Emoji and @ live in
 * `ComposerInsertTools`, in the box's bottom row.
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
      table: e.isActive('table'),
      textColor: currentColors(e).text,
      size: currentFontSize(e) ?? 'normal',
      align: currentAlign(e),
      rtl: currentDir(e) === 'rtl',
      style: ((): StyleKey => {
        if (e.isActive('heading', { level: 2 })) return 'h2';
        if (e.isActive('codeBlock')) return 'code';
        if (e.isActive('blockquote')) return 'quote';
        return 'normal';
      })(),
    }),
  });
  const [popup, setPopup] = useState<OpenPopup>(null);
  // The last text colour picked, shown as the underline of the colour button.
  const [lastColor, setLastColor] = useState<ColorKey | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Measured widths (tool id -> outer width) and the room the row has; 0 means "not measured".
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [room, setRoom] = useState(0);
  const [gap, setGap] = useState(0);
  // Roving focus: the one button that is in the tab order.
  const [stop, setStop] = useState<string | null>(null);
  useEffect(() => onPopupChange?.(popup !== null), [popup, onPopupChange]);

  const close = () => setPopup(null);
  const toggle = (kind: PopupKind) => (event: MouseEvent<HTMLElement>) => {
    const anchor = event.currentTarget;
    setPopup((open) => (open?.kind === kind ? null : { kind, anchor }));
  };
  const openAt = (kind: PopupKind) => (anchor: HTMLElement) => setPopup({ kind, anchor });
  const chain = () => editor.chain().focus();
  // A menu item runs its command, then closes the menu.
  const run = (command: () => void) => () => {
    command();
    close();
  };

  const currentStyle = COMPOSER_STYLES.find((s) => s.key === state.style) ?? COMPOSER_STYLES[0]!;
  const underline = state.textColor ?? lastColor;
  const colorStyle = underline
    ? ({ '--atrium-current-color': `var(--atrium-text-${underline})` } as CSSProperties)
    : undefined;
  const AlignIcon = ALIGNS.find((a) => a.key === state.align)?.Icon ?? AlignLeft;

  const tools: ToolDef[] = [
    {
      id: 'style',
      button: {
        label: `Text style: ${currentStyle.name}`,
        Icon: ParagraphIcon,
        popup: true,
        expanded: popup?.kind === 'style',
        onClick: toggle('style'),
      },
      fromMore: openAt('style'),
    },
    {
      id: 'bold',
      button: {
        label: 'Bold',
        shortcut: `${MOD}B`,
        Icon: Bold,
        active: state.bold,
        onClick: () => chain().toggleBold().run(),
      },
      fromMore: () => chain().toggleBold().run(),
    },
    {
      id: 'italic',
      button: {
        label: 'Italic',
        shortcut: `${MOD}I`,
        Icon: Italic,
        active: state.italic,
        onClick: () => chain().toggleItalic().run(),
      },
      fromMore: () => chain().toggleItalic().run(),
    },
    {
      id: 'underline',
      button: {
        label: 'Underline',
        shortcut: `${MOD}U`,
        Icon: Underline,
        active: state.underline,
        onClick: () => chain().toggleUnderline().run(),
      },
      fromMore: () => chain().toggleUnderline().run(),
    },
    {
      id: 'strike',
      button: {
        label: 'Strikethrough',
        shortcut: `${MOD}${SHIFT}S`,
        Icon: Strikethrough,
        active: state.strike,
        onClick: () => chain().toggleStrike().run(),
      },
      fromMore: () => chain().toggleStrike().run(),
    },
    {
      id: 'color',
      button: {
        label: 'Text colour and highlight',
        Icon: TextColorIcon,
        popup: true,
        expanded: popup?.kind === 'color',
        onClick: toggle('color'),
      },
      fromMore: openAt('color'),
      wrapperStyle: colorStyle,
    },
    {
      id: 'size',
      button: {
        label: 'Font size',
        Icon: TextBig,
        popup: true,
        expanded: popup?.kind === 'size',
        onClick: toggle('size'),
      },
      fromMore: openAt('size'),
    },
    {
      id: 'numbers',
      button: {
        label: 'Numbered list',
        shortcut: `${MOD}${SHIFT}7`,
        Icon: NumberedList,
        active: state.numbers,
        onClick: () => chain().toggleOrderedList().run(),
      },
      fromMore: () => chain().toggleOrderedList().run(),
    },
    {
      id: 'bullets',
      button: {
        label: 'Bulleted list',
        shortcut: `${MOD}${SHIFT}8`,
        Icon: Bullets,
        active: state.bullets,
        onClick: () => chain().toggleBulletList().run(),
      },
      fromMore: () => chain().toggleBulletList().run(),
    },
    {
      id: 'table',
      button: {
        label: 'Table',
        Icon: Table,
        active: state.table,
        onClick: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      fromMore: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: 'link',
      button: {
        label: 'Link',
        Icon: LinkIcon,
        active: state.link,
        popup: true,
        expanded: popup?.kind === 'link',
        onClick: toggle('link'),
      },
      fromMore: openAt('link'),
    },
    {
      id: 'align',
      button: {
        label: 'Alignment',
        Icon: AlignIcon,
        popup: true,
        expanded: popup?.kind === 'align',
        onClick: toggle('align'),
      },
      fromMore: openAt('align'),
    },
    {
      id: 'divider',
      button: {
        label: 'Divider',
        Icon: Divider,
        onClick: () => chain().setHorizontalRule().run(),
      },
      fromMore: () => chain().setHorizontalRule().run(),
    },
    {
      id: 'dir',
      button: {
        label: 'Text direction',
        Icon: DirectionIcon,
        active: state.rtl,
        onClick: () => composerMarks.toggleDirection(editor),
      },
      fromMore: () => composerMarks.toggleDirection(editor),
    },
    {
      id: 'tasks',
      button: {
        label: 'Checklist',
        shortcut: `${MOD}${SHIFT}9`,
        Icon: CheckList,
        active: state.tasks,
        onClick: () => chain().toggleTaskList().run(),
      },
      fromMore: () => chain().toggleTaskList().run(),
    },
  ];

  // Measure each rendered tool (and More) after every render; a tool that has moved into More
  // keeps the width it last had.
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
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const visible: Set<string> =
    room > 0
      ? toolsThatFit(
          tools.map((t) => ({ id: t.id, width: (widths[t.id] ?? 0) + gap })),
          // Fixed: the More button and the gap before it.
          room - ((widths.more ?? 0) + gap),
          COMPOSER_HIDE_ORDER,
        )
      : new Set(tools.map((t) => t.id));
  const shown = tools.filter((t) => visible.has(t.id));
  const hidden = tools.filter((t) => !visible.has(t.id));
  const rovingIds = [...shown.map((t) => t.id), ...(hidden.length > 0 ? ['more'] : [])];
  const stopId = stop && rovingIds.includes(stop) ? stop : rovingIds[0];
  const moreAnchor = popup?.kind === 'more' ? popup.anchor : null;
  const fromMore = (tool: ToolDef) => () => {
    close();
    if (moreAnchor) tool.fromMore(moreAnchor);
  };

  // ARIA toolbar pattern: Left/Right/Home/End move between the buttons.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-roving]'),
    ];
    const at = buttons.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const last = buttons.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: at === last ? 0 : at + 1,
      ArrowLeft: at === 0 ? last : at - 1,
      Home: 0,
      End: last,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    buttons[to]?.focus();
  };

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="horizontal"
      ref={toolbarRef}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const id = (event.target as HTMLElement).dataset?.roving;
        if (id) setStop(id);
      }}
    >
      {shown.map((tool) =>
        tool.wrapperStyle ? (
          <span key={tool.id} className={styles.colorTool} style={tool.wrapperStyle}>
            <Tool {...tool.button} fitId={tool.id} tabStop={stopId === tool.id} />
          </span>
        ) : (
          <Fragment key={tool.id}>
            <Tool {...tool.button} fitId={tool.id} tabStop={stopId === tool.id} />
          </Fragment>
        ),
      )}
      {hidden.length > 0 ? (
        <Tool
          label="More"
          Icon={MoreActions}
          popup
          expanded={popup?.kind === 'more'}
          fitId="more"
          tabStop={stopId === 'more'}
          onClick={toggle('more')}
        />
      ) : null}

      {popup?.kind === 'style' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="Text style">
          <div className={descriptionStyles.styleList} role="menu" aria-label="Text style">
            {COMPOSER_STYLES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="menuitem"
                className={classNames(descriptionStyles.styleOption, descriptionStyles[s.preview])}
                onMouseDown={(event) => event.preventDefault()}
                onClick={run(() => s.apply(chain()))}
              >
                <span className={descriptionStyles.fontCheck}>
                  {s.key === currentStyle.key ? <Check aria-hidden /> : null}
                </span>
                {s.name}
              </button>
            ))}
          </div>
        </AnchoredPopup>
      ) : null}
      {popup?.kind === 'size' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="Font size">
          <div className={descriptionStyles.styleList} role="menu" aria-label="Font size">
            {SIZES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="menuitemradio"
                aria-checked={s.key === state.size}
                className={classNames(
                  descriptionStyles.styleOption,
                  descriptionStyles.styleNormal,
                  s.key !== 'normal' && `atrium-size-${s.key}`,
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={run(() => composerMarks.setFontSize(editor, s.key))}
              >
                <span className={descriptionStyles.fontCheck}>
                  {s.key === state.size ? <Check aria-hidden /> : null}
                </span>
                {s.name}
              </button>
            ))}
          </div>
        </AnchoredPopup>
      ) : null}
      {popup?.kind === 'align' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="Alignment">
          <div className={descriptionStyles.styleList} role="menu" aria-label="Alignment">
            {ALIGNS.map((a) => (
              <button
                key={a.key}
                type="button"
                role="menuitemradio"
                aria-checked={a.key === (state.align ?? 'left')}
                className={classNames(descriptionStyles.styleOption, descriptionStyles.styleNormal)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={run(() => composerMarks.setAlign(editor, a.key))}
              >
                <span className={descriptionStyles.fontCheck}>
                  {a.key === (state.align ?? 'left') ? <Check aria-hidden /> : null}
                </span>
                {a.name}
              </button>
            ))}
          </div>
        </AnchoredPopup>
      ) : null}
      {popup?.kind === 'more' ? (
        <AnchoredPopup anchor={popup.anchor} onClose={close} label="More formatting">
          <Menu id="composer-more" size="medium">
            {hidden.map((tool) => (
              <MenuItem
                key={tool.id}
                title={tool.button.label.replace(/^Text style: .*/, 'Text style')}
                icon={tool.button.Icon as ComponentProps<typeof MenuItem>['icon']}
                onClick={fromMore(tool)}
              />
            ))}
          </Menu>
        </AnchoredPopup>
      ) : null}
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
    </div>
  );
}

/**
 * The left of the box's bottom row: a button that starts an @mention and the emoji picker.
 * (Attach is hidden until updates can hold files.)
 */
export function ComposerInsertTools({
  editor,
  onPopupChange,
  onAttach,
}: {
  editor: Editor;
  onPopupChange?: (open: boolean) => void;
  /** Opens the file picker; without it the attach button is not shown. */
  onAttach?: () => void;
}) {
  const [emoji, setEmoji] = useState<HTMLElement | null>(null);
  useEffect(() => onPopupChange?.(emoji !== null), [emoji, onPopupChange]);

  // "@" opens the member list; after a word it needs a space first, like typing it would.
  const startMention = () => {
    const { from } = editor.state.selection;
    const before = from > 1 ? editor.state.doc.textBetween(from - 1, from, '\n', '\n') : '';
    const needsSpace = before !== '' && !/\s/.test(before);
    editor
      .chain()
      .focus()
      .insertContent(needsSpace ? ' @' : '@')
      .run();
  };

  return (
    <div className={styles.insertTools}>
      <Tool label="Mention someone" shortcut="@" Icon={Mention} onClick={startMention} />
      {onAttach ? <Tool label="Attach files" Icon={Attach} onClick={onAttach} /> : null}
      <Tool
        label="Emoji"
        Icon={EmojiIcon}
        popup
        expanded={emoji !== null}
        onClick={(event) => {
          const anchor = event.currentTarget;
          setEmoji((open) => (open ? null : anchor));
        }}
      />
      {emoji ? <EmojiPicker anchor={emoji} editor={editor} onClose={() => setEmoji(null)} /> : null}
    </div>
  );
}
