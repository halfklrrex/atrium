// Item descriptions: markdown-ish text <-> the ProseMirror JSON the web editor (Tiptap) stores in
// `items/{id}.description` as `{ doc, text }`. The conversion only produces nodes and marks the editor
// already supports (StarterKit + task lists), and the final value is built by the web app's own
// `buildDescription` (empty -> null, size cap, plain-text field), so nothing the app would reject is written.
import { itemDescriptionSchema } from '@atrium/shared';
import { buildDescription } from '../../../apps/web/src/components/item-view/description.ts';
import { McpUserError } from './errors.mjs';

export const MAX_MARKDOWN_CHARS = 50_000;

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
/** Nodes the markdown conversion can write and read back without loss. */
const PLAIN_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'hardBreak',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'blockquote',
  'horizontalRule',
]);

// ---- markdown -> doc --------------------------------------------------------------------------

const INLINE_SOURCE =
  /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|~~(.+?)~~|\*([^*\s][^*]*?)\*|(?<![A-Za-z0-9])_([^_\s][^_]*?)_(?![A-Za-z0-9])/;

const textNode = (text, marks) =>
  marks.length > 0
    ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) }
    : { type: 'text', text };

function inline(text, marks = []) {
  const out = [];
  let last = 0;
  // A fresh regex per call: the recursion below must not share `lastIndex`.
  const pattern = new RegExp(INLINE_SOURCE.source, 'g');
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(textNode(text.slice(last, m.index), marks));
    if (m[1] !== undefined) out.push(textNode(m[1], [...marks, { type: 'code' }]));
    else if (m[2] !== undefined) {
      if (SAFE_LINK.test(m[3])) {
        out.push(...inline(m[2], [...marks, { type: 'link', attrs: { href: m[3] } }]));
      } else out.push(textNode(m[0], marks)); // unsafe scheme: keep the text, drop the link
    } else if (m[4] !== undefined) out.push(...inline(m[4], [...marks, { type: 'bold' }]));
    else if (m[5] !== undefined) out.push(...inline(m[5], [...marks, { type: 'strike' }]));
    else out.push(...inline(m[6] ?? m[7], [...marks, { type: 'italic' }]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(textNode(text.slice(last), marks));
  return out.filter((n) => n.text !== '');
}

/** Lines joined by hard breaks, each parsed for inline marks. */
function inlineLines(lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    out.push(...inline(line));
  });
  return out;
}

const paragraph = (content) =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };

const LIST_LINE = /^( *)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const listKind = (m) => (TASK.test(m[3]) ? 'task' : /^\d/.test(m[2]) ? 'ordered' : 'bullet');

function parseList(lines, start) {
  const first = LIST_LINE.exec(lines[start]);
  const indent = first[1].length;
  const kind = listKind(first);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_LINE.exec(lines[i]);
    if (!m || m[1].length !== indent || listKind(m) !== kind) break;
    const task = TASK.exec(m[3]);
    const content = [paragraph(inline(task ? task[2] : m[3]))];
    i += 1;
    while (i < lines.length) {
      const next = LIST_LINE.exec(lines[i]);
      if (!next || next[1].length <= indent) break;
      const nested = parseList(lines, i);
      content.push(nested.node);
      i = nested.next;
    }
    items.push(
      kind === 'task'
        ? { type: 'taskItem', attrs: { checked: task[1] !== ' ' }, content }
        : { type: 'listItem', content },
    );
  }
  const type = kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList';
  return { node: { type, content: items }, next: i };
}

/** Markdown-ish text -> ProseMirror doc. Unknown syntax stays as plain text; HTML is never interpreted. */
export function markdownToDoc(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const content = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') {
      i += 1;
      continue;
    }
    const fence = /^```\s*([\w-]*)\s*$/.exec(trimmed);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '```') body.push(lines[i++]);
      i += 1;
      const code = body.join('\n');
      content.push({
        type: 'codeBlock',
        attrs: { language: fence[1] || null },
        ...(code ? { content: [{ type: 'text', text: code }] } : {}),
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed);
    if (heading) {
      content.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: inline(heading[2]),
      });
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      content.push({ type: 'horizontalRule' });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('>')) {
      const quoted = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      content.push({ type: 'blockquote', content: markdownToDoc(quoted.join('\n')).content });
      continue;
    }
    if (LIST_LINE.test(line)) {
      const list = parseList(lines, i);
      content.push(list.node);
      i = list.next;
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|>)/.test(lines[i].trim()) &&
      !LIST_LINE.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    content.push(paragraph(inlineLines(para)));
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

// ---- doc -> markdown --------------------------------------------------------------------------

function markText(node) {
  let out = node.text ?? '';
  for (const mark of node.marks ?? []) {
    if (mark.type === 'code') out = `\`${out}\``;
    else if (mark.type === 'bold') out = `**${out}**`;
    else if (mark.type === 'italic') out = `*${out}*`;
    else if (mark.type === 'strike') out = `~~${out}~~`;
    else if (mark.type === 'link' && mark.attrs?.href) out = `[${out}](${mark.attrs.href})`;
  }
  return out;
}

function inlineMd(nodes = []) {
  return nodes
    .map((n) => {
      if (n.type === 'text') return markText(n);
      if (n.type === 'hardBreak') return '\n';
      if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](image)`;
      if (n.type === 'emoji' && n.attrs?.name) return `:${n.attrs.name}:`;
      if (n.type === 'mention' && n.attrs?.label) return `@${n.attrs.label}`;
      return inlineMd(n.content);
    })
    .join('');
}

function blockMd(node, indent = '') {
  const kids = node.content ?? [];
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(node.attrs?.level ?? 1)} ${inlineMd(kids)}`;
    case 'codeBlock':
      return `\`\`\`${node.attrs?.language ?? ''}\n${inlineMd(kids)}\n\`\`\``;
    case 'blockquote':
      return kids
        .map((k) => blockMd(k))
        .join('\n\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'horizontalRule':
      return '---';
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return kids
        .map((item, n) => {
          const marker =
            node.type === 'orderedList'
              ? `${n + 1}.`
              : node.type === 'taskList'
                ? `- [${item.attrs?.checked ? 'x' : ' '}]`
                : '-';
          const [head, ...rest] = item.content ?? [];
          const lines = [`${indent}${marker} ${head ? inlineMd(head.content) : ''}`];
          for (const r of rest) lines.push(blockMd(r, `${indent}  `));
          return lines.join('\n');
        })
        .join('\n');
    case 'paragraph':
      return inlineMd(kids);
    default:
      return kids.length ? kids.map((k) => blockMd(k)).join('\n\n') : inlineMd([node]);
  }
}

export function docToMarkdown(doc) {
  return (doc?.content ?? []).map((n) => blockMd(n)).join('\n\n');
}

/** Node types in `doc` that markdown cannot round-trip (images, tables, mentions, emoji, ...). */
export function richNodeTypes(doc) {
  const found = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type && !PLAIN_NODES.has(n.type)) found.add(n.type);
    for (const mark of n.marks ?? []) {
      if (!['bold', 'italic', 'strike', 'code', 'link'].includes(mark.type)) found.add(mark.type);
    }
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return [...found];
}

// ---- stored value -----------------------------------------------------------------------------

/** The `{ doc, text }` to store for `doc` (or null when empty), through the web app's own builder. */
export function toStoredDescription(doc) {
  const built = buildDescription(doc);
  if (!built.ok) throw new McpUserError(built.message);
  if (built.value) {
    const parsed = itemDescriptionSchema.safeParse(built.value);
    if (!parsed.success) throw new McpUserError('The description is not valid.');
  }
  return built.value;
}

/** Appends `addition`'s blocks to an existing doc (keeping every existing node untouched). */
export function appendDoc(existing, addition) {
  const base = existing?.content ?? [];
  return { ...(existing ?? { type: 'doc' }), type: 'doc', content: [...base, ...addition.content] };
}
