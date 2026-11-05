import { NOTIFICATION_LIMITS } from '@atrium/shared';
import { docToText, isEmptyDoc, stripTransientNodes } from '../item-view/description';

/** What the composer hands to `createUpdate` / `createReply`. */
export interface UpdateBody {
  /** The ProseMirror JSON document. */
  contentDoc: Record<string, unknown>;
  /** The plain-text mirror of the doc (mentions as `@Name`, emoji as `:name:`). */
  content: string;
  /** Uids of the mention chips in the doc: unique, at most `NOTIFICATION_LIMITS.mentions`. */
  mentions: string[];
}

/** The uids of every mention chip in a doc, in order of appearance, without duplicates, capped. */
export function mentionIdsInDoc(doc: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (n.type === 'mention' && typeof n.attrs?.id === 'string' && n.attrs.id) ids.add(n.attrs.id);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return [...ids].slice(0, NOTIFICATION_LIMITS.mentions);
}

type Json = Record<string, unknown>;

/**
 * The editor writes `align: null, dir: null` on every paragraph and heading; leave them out of
 * what is stored (an empty `attrs` goes too), so a plain post stays a plain doc.
 */
function dropUnsetBlockAttrs(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  let out = node as Json & { type?: string; attrs?: Json; content?: unknown[] };
  if ((out.type === 'paragraph' || out.type === 'heading') && out.attrs) {
    const { align, dir, ...rest } = out.attrs;
    const attrs = {
      ...rest,
      ...(align == null ? {} : { align }),
      ...(dir == null ? {} : { dir }),
    };
    const { attrs: _unused, ...others } = out;
    out = Object.keys(attrs).length > 0 ? { ...others, attrs } : others;
  }
  return Array.isArray(out.content)
    ? { ...out, content: out.content.map(dropUnsetBlockAttrs) }
    : out;
}

/**
 * The doc with each table replaced by one paragraph of its text: cells of a row joined with a
 * space, rows with a newline. (`docToText` alone would put every cell on its own line.)
 */
function flattenTables(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as Json & { type?: string; content?: unknown[] };
  if (n.type === 'table') {
    const rows = (n.content ?? []).map((row) =>
      (((row as Json).content as unknown[] | undefined) ?? [])
        .map((cell) => docToText(cell).replace(/\s*\n\s*/g, ' '))
        .filter(Boolean)
        .join(' '),
    );
    const text = rows.filter(Boolean).join('\n');
    return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
  }
  return Array.isArray(n.content) ? { ...n, content: n.content.map(flattenTables) } : n;
}

/** What to store for the composer's doc, or `null` when it is empty and so cannot be posted. */
export function buildUpdateBody(editorDoc: Record<string, unknown>): UpdateBody | null {
  const contentDoc = dropUnsetBlockAttrs(stripTransientNodes(editorDoc)) as Json;
  if (isEmptyDoc(contentDoc)) return null;
  // A post that is only a divider has no text, so (like the server) it counts as empty.
  const content = docToText(flattenTables(contentDoc));
  if (!content) return null;
  return { contentDoc, content, mentions: mentionIdsInDoc(contentDoc) };
}
