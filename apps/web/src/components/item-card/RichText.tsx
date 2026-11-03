import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_HIGHLIGHT, isColorKey } from '../item-view/editor-palette';
import mentionStyles from './MentionTextarea.module.css';
import { safeLinkHref } from './safe-link';
import styles from './RichText.module.css';

interface DocNode {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  marks?: unknown;
  content?: unknown;
}

/** Deeper than any real post; past it a node shows its text only (a guard for hand-made docs). */
const MAX_DEPTH = 12;

const asNode = (value: unknown): DocNode | null =>
  value && typeof value === 'object' ? (value as DocNode) : null;

const childrenOf = (node: DocNode): unknown[] => (Array.isArray(node.content) ? node.content : []);

/** All the text under a node, for node types this renderer does not know. */
function plainText(node: DocNode): string {
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'mention' && typeof node.attrs?.label === 'string') {
    return `@${node.attrs.label}`;
  }
  return childrenOf(node)
    .map((child) => {
      const next = asNode(child);
      return next ? plainText(next) : '';
    })
    .join('');
}

const emojiCache = new Map<string, string>();

/** An emoji's character. The emoji data is large, so it loads on first use; `:name:` shows until then. */
function EmojiGlyph({ name }: { name: string }) {
  const [glyph, setGlyph] = useState<string | undefined>(emojiCache.get(name));
  useEffect(() => {
    if (glyph !== undefined) return;
    let cancelled = false;
    void import('../item-view/emoji-data').then(({ emojiByName }) => {
      const found = emojiByName(name)?.emoji;
      if (found) emojiCache.set(name, found);
      if (!cancelled && found) setGlyph(found);
    });
    return () => {
      cancelled = true;
    };
  }, [glyph, name]);
  return <span title={`:${name}:`}>{glyph ?? `:${name}:`}</span>;
}

/** A text node with its marks. Only the marks the composer can make are known; others are dropped. */
function renderText(node: DocNode, key: number): ReactNode {
  let out: ReactNode = String(node.text);
  const marks = (Array.isArray(node.marks) ? node.marks : [])
    .map(asNode)
    .filter((mark): mark is DocNode => mark !== null);
  const find = (type: string) => marks.find((m) => m.type === type);

  if (find('code')) out = <code>{out}</code>;
  if (find('bold')) out = <strong>{out}</strong>;
  if (find('italic')) out = <em>{out}</em>;
  if (find('underline')) out = <u>{out}</u>;
  if (find('strike')) out = <s>{out}</s>;
  const color = find('textStyle')?.attrs?.color;
  if (isColorKey(color)) out = <span className={`atrium-text-${color}`}>{out}</span>;
  const highlight = find('highlight');
  if (highlight) {
    const tone = isColorKey(highlight.attrs?.color) ? highlight.attrs.color : DEFAULT_HIGHLIGHT;
    out = <mark className={`atrium-highlight-${tone}`}>{out}</mark>;
  }
  const link = find('link');
  const href = link ? safeLinkHref(link.attrs?.href) : null;
  if (href) {
    out = (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {out}
      </a>
    );
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function renderChildren(node: DocNode, depth: number): ReactNode[] {
  return childrenOf(node).map((child, index) => renderNode(child, index, depth + 1));
}

function renderNode(value: unknown, key: number, depth: number): ReactNode {
  const node = asNode(value);
  if (!node) return null;
  if (typeof node.text === 'string') return renderText(node, key);
  if (depth > MAX_DEPTH) return <Fragment key={key}>{plainText(node)}</Fragment>;

  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderChildren(node, depth)}</p>;
    case 'hardBreak':
      return <br key={key} />;
    case 'bulletList':
      return <ul key={key}>{renderChildren(node, depth)}</ul>;
    case 'orderedList': {
      const start = node.attrs?.start;
      return (
        <ol key={key} start={Number.isInteger(start) ? (start as number) : undefined}>
          {renderChildren(node, depth)}
        </ol>
      );
    }
    case 'listItem':
      return <li key={key}>{renderChildren(node, depth)}</li>;
    case 'taskList':
      return (
        <ul key={key} className={styles.taskList}>
          {renderChildren(node, depth)}
        </ul>
      );
    case 'taskItem':
      return (
        <li key={key} className={styles.taskItem}>
          <input type="checkbox" checked={node.attrs?.checked === true} disabled readOnly />
          <div>{renderChildren(node, depth)}</div>
        </li>
      );
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node, depth)}</blockquote>;
    case 'mention':
      return (
        <span key={key} className={mentionStyles.mention}>
          @{typeof node.attrs?.label === 'string' ? node.attrs.label : 'member'}
        </span>
      );
    case 'emoji':
      return typeof node.attrs?.name === 'string' ? (
        <EmojiGlyph key={key} name={node.attrs.name} />
      ) : null;
    default:
      // A node this renderer does not know (a newer client wrote it): its text, nothing more.
      return <Fragment key={key}>{plainText(node)}</Fragment>;
  }
}

/**
 * An update or reply written in the rich composer: the stored ProseMirror JSON walked into React
 * elements. It renders only the nodes and marks the composer can produce; there is no HTML
 * parsing and no `dangerouslySetInnerHTML`, and links must be http, https or mailto.
 */
export function RichText({ doc }: { doc: unknown }) {
  const root = asNode(doc);
  if (!root) return null;
  return <div className={styles.root}>{renderChildren(root, 0)}</div>;
}
