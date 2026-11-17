import { DOC_LIMITS, docBodyBytes } from '@atrium/shared';
import type { DescriptionResult } from '../item-view/description';
import { docToText, stripTransientNodes } from '../item-view/description';
import type { MentionSource } from '../item-view/mention/MentionMenu';
import { useDocMeta } from '../../data/docs';

export const DOC_TOO_LONG = 'This doc is too long to save. Split it into two docs.';

/**
 * What a doc body save sends. Unlike a description, an empty doc is still saved (as an empty doc),
 * so clearing the text sticks. Over the size cap, nothing is saved and the editor keeps the text.
 */
export function buildDocValue(editorDoc: Record<string, unknown>): DescriptionResult {
  const doc = stripTransientNodes(editorDoc);
  if (docBodyBytes(doc) > DOC_LIMITS.bodyBytes) return { ok: false, message: DOC_TOO_LONG };
  return { ok: true, value: { doc, text: docToText(doc).slice(0, DOC_LIMITS.text) } };
}

/** The "@" list of a doc: the workspace members who can read it. */
export function docMentionSource(docId: string): MentionSource {
  return {
    useScope: () => {
      const { data: doc } = useDocMeta(docId);
      return { access: doc, workspaceId: doc?.workspaceId };
    },
  };
}
