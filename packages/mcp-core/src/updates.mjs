// Update (comment) and reply bodies: markdown -> the rich-text document the web composer stores
// (`contentDoc`), its plain-text mirror (`content`) and the uids of the @mention chips (`mentions`).
// The text mirror is built by the web app's own `docToText`; the result is checked with the same
// input schema the web uses (`createItemUpdateInputSchema`), so nothing the app would reject is written.
import { NOTIFICATION_LIMITS, createItemUpdateInputSchema } from '@atrium/shared';
import { docToText, isEmptyDoc } from '@atrium/shared';
import { McpUserError } from './errors.mjs';
import { markdownToDoc } from './description.mjs';

/** `@[Name]` in the text: a mention of the workspace member with that name, email or uid. */
const MENTION = /@\[([^\]\n]{1,100})\]/g;

function mentionNodes(node, resolve, found) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'codeBlock' || !Array.isArray(node.content)) return node;
  const content = node.content.flatMap((child) => {
    if (child.type !== 'text' || (child.marks ?? []).some((m) => m.type === 'code')) {
      return [mentionNodes(child, resolve, found)];
    }
    const parts = [];
    let last = 0;
    const text = child.text ?? '';
    for (const match of text.matchAll(MENTION)) {
      if (match.index > last) parts.push({ ...child, text: text.slice(last, match.index) });
      const member = resolve(match[1]);
      found.add(member.uid);
      parts.push({ type: 'mention', attrs: { id: member.uid, label: member.name } });
      last = match.index + match[0].length;
    }
    if (parts.length === 0) return [child];
    if (last < text.length) parts.push({ ...child, text: text.slice(last) });
    return parts;
  });
  return { ...node, content };
}

/**
 * `{ content, contentDoc, mentions }` for a markdown body. With `resolve` (name -> `{uid, name}`),
 * `@[Name]` becomes a mention chip; without it the tokens stay plain `@Name` text (edits: mentions
 * are fixed when a post is created, and the app never notifies on edit).
 */
export function buildRichBody(markdown, resolve) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new McpUserError('The text is empty.');
  }
  const source = resolve ? markdown : markdown.replace(MENTION, '@$1');
  const found = new Set();
  const doc = resolve ? mentionNodes(markdownToDoc(source), resolve, found) : markdownToDoc(source);
  if (isEmptyDoc(doc)) throw new McpUserError('The text is empty.');
  const content = docToText(doc);
  if (!content) throw new McpUserError('The text is empty.');
  const mentions = [...found];
  if (mentions.length > NOTIFICATION_LIMITS.mentions) {
    throw new McpUserError(`At most ${NOTIFICATION_LIMITS.mentions} people can be mentioned.`);
  }
  const parsed = createItemUpdateInputSchema.safeParse({
    content,
    contentDoc: doc,
    ...(mentions.length ? { mentions } : {}),
  });
  if (!parsed.success) {
    throw new McpUserError(
      `The text is not valid: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return { content: parsed.data.content, contentDoc: doc, mentions };
}

/** Finds a member by `@[...]` text: exact uid, display name or email (case-insensitive). */
export function memberResolver(members, selfUid) {
  const norm = (text) => String(text).trim().toLowerCase();
  return (ref) => {
    if (norm(ref) === 'me') {
      const me = members.find((m) => m.uid === selfUid);
      if (me) return me;
    }
    const byUid = members.find((m) => m.uid === ref);
    if (byUid) return byUid;
    const hits = members.filter((m) => norm(m.name) === norm(ref) || norm(m.email) === norm(ref));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw new McpUserError(`More than one member matches @[${ref}]; use the email or uid.`);
    }
    const known = members.map((m) => m.name).join(', ') || 'none';
    throw new McpUserError(
      `@[${ref}] is not a member who can see this board. Members: ${known}. ` +
        'Use atrium_list_members to see them.',
    );
  };
}
