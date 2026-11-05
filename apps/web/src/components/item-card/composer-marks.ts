import { Extension, type Editor } from '@tiptap/react';
import { KeyedTextStyle } from '../item-view/editor-marks';
import { isColorKey, isFontKey } from '../item-view/editor-palette';

/** The font sizes of the composer, as keys. Normal is "no key". */
export const FONT_SIZE_KEYS = ['small', 'large', 'huge'] as const;
export type FontSizeKey = (typeof FONT_SIZE_KEYS)[number];
export const ALIGN_KEYS = ['left', 'center', 'right'] as const;
export type AlignKey = (typeof ALIGN_KEYS)[number];
export const DIR_KEYS = ['ltr', 'rtl'] as const;
export type DirKey = (typeof DIR_KEYS)[number];

export const isFontSizeKey = (value: unknown): value is FontSizeKey =>
  typeof value === 'string' && (FONT_SIZE_KEYS as readonly string[]).includes(value);
export const isAlignKey = (value: unknown): value is AlignKey =>
  typeof value === 'string' && (ALIGN_KEYS as readonly string[]).includes(value);
export const isDirKey = (value: unknown): value is DirKey =>
  typeof value === 'string' && (DIR_KEYS as readonly string[]).includes(value);

/** The description's keyed text-style mark, which also accepts a span that carries only a size. */
export const ComposerTextStyle = KeyedTextStyle.extend({
  parseHTML() {
    return [
      {
        tag: 'span[data-color], span[data-font], span[data-size]',
        consuming: false,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return isColorKey(el.dataset.color) ||
            isFontKey(el.dataset.font) ||
            isFontSizeKey(el.dataset.size)
            ? {}
            : false;
        },
      },
    ];
  },
});

/** `fontSize` on the text-style mark: a size KEY, rendered as `data-size` plus a class, never CSS. */
export const FontSizeKeys = Extension.create({
  name: 'atriumFontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              isFontSizeKey(element.dataset.size) ? element.dataset.size : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              isFontSizeKey(attributes.fontSize)
                ? { 'data-size': attributes.fontSize, class: `atrium-size-${attributes.fontSize}` }
                : {},
          },
        },
      },
    ];
  },
});

/** `align` and `dir` on paragraphs and headings: keys, never CSS. */
export const BlockLayoutKeys = Extension.create({
  name: 'atriumBlockLayout',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          align: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              isAlignKey(element.dataset.align) ? element.dataset.align : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              isAlignKey(attributes.align)
                ? { 'data-align': attributes.align, class: `atrium-align-${attributes.align}` }
                : {},
          },
          dir: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              isDirKey(element.dataset.dir) ? element.dataset.dir : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              isDirKey(attributes.dir) ? { 'data-dir': attributes.dir, dir: attributes.dir } : {},
          },
        },
      },
    ];
  },
});

export function currentFontSize(editor: Editor): FontSizeKey | null {
  const size = editor.getAttributes('textStyle').fontSize;
  return isFontSizeKey(size) ? size : null;
}

export function currentAlign(editor: Editor): AlignKey | null {
  const value = editor.getAttributes('paragraph').align ?? editor.getAttributes('heading').align;
  return isAlignKey(value) ? value : null;
}

export function currentDir(editor: Editor): DirKey | null {
  const value = editor.getAttributes('paragraph').dir ?? editor.getAttributes('heading').dir;
  return isDirKey(value) ? value : null;
}

/** The commands the composer toolbar runs. They keep the stored doc to keys only. */
export const composerMarks = {
  /** Sets the size by key; anything else (or `normal`) removes it. */
  setFontSize: (editor: Editor, key: string) => {
    if (!isFontSizeKey(key)) {
      return editor
        .chain()
        .focus()
        .setMark('textStyle', { fontSize: null })
        .removeEmptyTextStyle()
        .run();
    }
    return editor.chain().focus().setMark('textStyle', { fontSize: key }).run();
  },
  /** Aligns the paragraphs and headings in the selection; the same key again clears it. */
  setAlign: (editor: Editor, key: AlignKey) => {
    const next = currentAlign(editor) === key ? null : key;
    return editor
      .chain()
      .focus()
      .updateAttributes('paragraph', { align: next })
      .updateAttributes('heading', { align: next })
      .run();
  },
  /** Flips between right-to-left and left-to-right for the blocks in the selection. */
  toggleDirection: (editor: Editor) => {
    const next: DirKey = currentDir(editor) === 'rtl' ? 'ltr' : 'rtl';
    return editor
      .chain()
      .focus()
      .updateAttributes('paragraph', { dir: next })
      .updateAttributes('heading', { dir: next })
      .run();
  },
};
