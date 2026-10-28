import { ITEM_DESCRIPTION_DOC_MAX_BYTES, ITEM_DESCRIPTION_TEXT_MAX } from '@atrium/shared';

export interface DescriptionValue {
  doc: Record<string, unknown>;
  text: string;
}

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'codeBlock',
  'blockquote',
  'tableCell',
  'tableHeader',
  'image',
]);

/** Nodes that count as content even with no text (add new ones, e.g. mentions, here). */
const CONTENT_NODES = new Set(['image', 'horizontalRule', 'table', 'emoji']);

/** Nodes that exist only while something happens (an image uploading); they are never saved. */
const TRANSIENT_NODES = new Set(['imageUpload']);

/** The doc without transient nodes (upload placeholders), so a save mid-upload stores no stale tile. */
export function stripTransientNodes(doc: Record<string, unknown>): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const n = node as { content?: unknown[] };
    if (!Array.isArray(n.content)) return node;
    const content = n.content
      .filter((child) => !TRANSIENT_NODES.has((child as { type?: string })?.type ?? ''))
      .map(strip);
    return { ...n, content };
  };
  return strip(doc) as Record<string, unknown>;
}

/**
 * The plain text of a ProseMirror JSON doc, for search; blocks are separated by a newline. Images
 * contribute their alt text and emoji their `:shortcode:`.
 */
export function docToText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: string;
      text?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    };
    if (typeof n.text === 'string') parts.push(n.text);
    if (n.type === 'image' && n.attrs?.alt) parts.push(` ${String(n.attrs.alt)} `);
    if (n.type === 'emoji' && n.attrs?.name) parts.push(`:${String(n.attrs.name)}:`);
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type && BLOCKS.has(n.type)) parts.push('\n');
  };
  walk(doc);
  return parts
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** True when the doc has no text and no content node (image, divider, table, emoji) worth saving. */
export function isEmptyDoc(doc: unknown): boolean {
  const hasContent = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === 'string' && n.text.trim().length > 0) return true;
    if (n.type && CONTENT_NODES.has(n.type)) return true;
    return Array.isArray(n.content) && n.content.some(hasContent);
  };
  return !hasContent(doc);
}

export type DescriptionResult =
  { ok: true; value: DescriptionValue | null } | { ok: false; message: string };

/**
 * What to store for an editor doc: `null` when empty, the doc plus its capped plain text, or a
 * friendly error when the serialised doc is over the size limit.
 */
export function buildDescription(editorDoc: Record<string, unknown>): DescriptionResult {
  const doc = stripTransientNodes(editorDoc);
  if (isEmptyDoc(doc)) return { ok: true, value: null };
  if (JSON.stringify(doc).length > ITEM_DESCRIPTION_DOC_MAX_BYTES) {
    return { ok: false, message: 'This description is too long to save. Please shorten it.' };
  }
  return { ok: true, value: { doc, text: docToText(doc).slice(0, ITEM_DESCRIPTION_TEXT_MAX) } };
}

/**
 * A trailing debouncer: `schedule(fn)` runs the LAST scheduled function after `ms` of quiet;
 * `flush()` runs it now; `cancel()` drops it.
 */
export function createDebouncer(ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const fn = pending;
    pending = null;
    fn?.();
  };
  return {
    schedule(fn: () => void) {
      pending = fn;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    },
    flush: run,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    hasPending: () => pending !== null,
  };
}

export const DESCRIPTION_SAVE_DELAY = 800;
