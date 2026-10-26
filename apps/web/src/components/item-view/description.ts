import { ITEM_DESCRIPTION_DOC_MAX_BYTES, ITEM_DESCRIPTION_TEXT_MAX } from '@atrium/shared';

export interface DescriptionValue {
  doc: Record<string, unknown>;
  text: string;
}

const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'codeBlock', 'blockquote']);

/** The plain text of a ProseMirror JSON doc, for search; blocks are separated by a newline. */
export function docToText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (typeof n.text === 'string') parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (n.type && BLOCKS.has(n.type)) parts.push('\n');
  };
  walk(doc);
  return parts
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** True when the doc has no text worth saving. */
export function isEmptyDoc(doc: unknown): boolean {
  return docToText(doc).length === 0;
}

export type DescriptionResult =
  { ok: true; value: DescriptionValue | null } | { ok: false; message: string };

/**
 * What to store for an editor doc: `null` when empty, the doc plus its capped plain text, or a
 * friendly error when the serialised doc is over the size limit.
 */
export function buildDescription(doc: Record<string, unknown>): DescriptionResult {
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
