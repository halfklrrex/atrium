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

/** What to store for the composer's doc, or `null` when it is empty and so cannot be posted. */
export function buildUpdateBody(editorDoc: Record<string, unknown>): UpdateBody | null {
  const contentDoc = stripTransientNodes(editorDoc);
  if (isEmptyDoc(contentDoc)) return null;
  const content = docToText(contentDoc);
  if (!content) return null;
  return { contentDoc, content, mentions: mentionIdsInDoc(contentDoc) };
}
