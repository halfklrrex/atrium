import { Highlight } from '@tiptap/extension-highlight';
import { Extension, type Editor } from '@tiptap/react';
import { TextStyle } from '@tiptap/extension-text-style';
import { DEFAULT_HIGHLIGHT, isColorKey, isFontKey, type ColorKey } from './editor-palette';
import { ensureFontLoaded } from './editor-fonts';

/**
 * The text-style mark, reduced to our two keyed attributes. It parses only spans that carry one of
 * our `data-*` keys, so foreign inline `style="color:#f00"` on paste is dropped with the span (the
 * text stays) and no empty marks reach the doc.
 */
export const KeyedTextStyle = TextStyle.extend({
  parseHTML() {
    return [
      {
        tag: 'span[data-color], span[data-font]',
        consuming: false,
        getAttrs: (element) => {
          const el = element as HTMLElement;
          return isColorKey(el.dataset.color) || isFontKey(el.dataset.font) ? {} : false;
        },
      },
    ];
  },
});

/** `color` and `fontFamily` on the text-style mark: palette and font KEYS, rendered as data-* plus a class. */
export const TextStyleKeys = Extension.create({
  name: 'atriumTextStyleKeys',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              isColorKey(element.dataset.color) ? element.dataset.color : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              isColorKey(attributes.color)
                ? { 'data-color': attributes.color, class: `atrium-text-${attributes.color}` }
                : {},
          },
          fontFamily: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              isFontKey(element.dataset.font) ? element.dataset.font : null,
            renderHTML: (attributes: Record<string, unknown>) =>
              isFontKey(attributes.fontFamily)
                ? {
                    'data-font': attributes.fontFamily,
                    class: `atrium-font-${attributes.fontFamily}`,
                  }
                : {},
          },
        },
      },
    ];
  },
});

/** Multicolour highlight whose colour is a palette key (`data-highlight` plus a class), never CSS. */
export const KeyedHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT,
        parseHTML: (element: HTMLElement) =>
          isColorKey(element.dataset.highlight) ? element.dataset.highlight : DEFAULT_HIGHLIGHT,
        renderHTML: (attributes: Record<string, unknown>) => {
          const key = isColorKey(attributes.color) ? attributes.color : DEFAULT_HIGHLIGHT;
          return { 'data-highlight': key, class: `atrium-highlight-${key}` };
        },
      },
    };
  },
});

/** The commands the toolbar runs. They keep the stored doc to palette and font keys only. */
export const marks = {
  setTextColor: (editor: Editor, key: ColorKey) =>
    editor.chain().focus().setMark('textStyle', { color: key }).run(),
  unsetTextColor: (editor: Editor) =>
    editor.chain().focus().setMark('textStyle', { color: null }).removeEmptyTextStyle().run(),
  setHighlightColor: (editor: Editor, key: ColorKey) =>
    editor.chain().focus().setHighlight({ color: key }).run(),
  unsetHighlight: (editor: Editor) => editor.chain().focus().unsetHighlight().run(),
  /** Sets the font by key, loading its stylesheet on first use; `default` removes the font. */
  setFont: (editor: Editor, key: string) => {
    if (!isFontKey(key)) {
      return editor
        .chain()
        .focus()
        .setMark('textStyle', { fontFamily: null })
        .removeEmptyTextStyle()
        .run();
    }
    ensureFontLoaded(key);
    return editor.chain().focus().setMark('textStyle', { fontFamily: key }).run();
  },
};

/** The key of the colour at the selection (text colour or highlight), if any. */
export function currentColors(editor: Editor): {
  text: ColorKey | null;
  highlight: ColorKey | null;
} {
  const text = editor.getAttributes('textStyle').color;
  const highlight = editor.isActive('highlight') ? editor.getAttributes('highlight').color : null;
  return {
    text: isColorKey(text) ? text : null,
    highlight: isColorKey(highlight) ? highlight : null,
  };
}
