import { FONTS, isFontKey } from './editor-palette';

const FONTS_ORIGIN = 'https://fonts.googleapis.com/css2';

/** The Google Fonts stylesheet URL for a font key, or null when index.html already loads it. */
export function fontStylesheetUrl(key: string): string | null {
  const font = FONTS.find((f) => f.key === key);
  if (!font?.family) return null;
  const family = font.family.replace(/ /g, '+');
  const axes = font.weights.split(';');
  const spec = font.italics
    ? `ital,wght@${[...axes.map((w) => `0,${w}`), ...axes.map((w) => `1,${w}`)].join(';')}`
    : `wght@${font.weights}`;
  return `${FONTS_ORIGIN}?family=${family}:${spec}&display=swap`;
}

/**
 * Loads a font's stylesheet the first time the key is rendered or chosen: one `<link>` per family,
 * never repeated, and none for families that index.html already loads.
 */
export function ensureFontLoaded(key: string): void {
  if (typeof document === 'undefined') return;
  const href = fontStylesheetUrl(key);
  if (!href) return;
  if (document.head.querySelector(`link[data-atrium-font="${key}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.atriumFont = key;
  document.head.appendChild(link);
}

/** Every font key a ProseMirror JSON doc uses. */
export function collectFontKeys(doc: unknown): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { marks?: unknown; content?: unknown };
    if (Array.isArray(n.marks)) {
      for (const mark of n.marks as Array<{ type?: string; attrs?: { fontFamily?: unknown } }>) {
        const font = mark?.attrs?.fontFamily;
        if (mark?.type === 'textStyle' && isFontKey(font)) keys.add(font);
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return keys;
}

/** Loads every font the doc uses (viewers' editors call this on load). */
export function ensureDocFontsLoaded(doc: unknown): void {
  collectFontKeys(doc).forEach(ensureFontLoaded);
}
