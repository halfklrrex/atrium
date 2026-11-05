import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { isAlignKey, isDirKey, isFontSizeKey } from './composer-marks';
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
/** The largest column or row span a cell can render with. */
const MAX_SPAN = 50;

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
  const textStyle = find('textStyle')?.attrs;
  const color = textStyle?.color;
  if (isColorKey(color)) out = <span className={`atrium-text-${color}`}>{out}</span>;
  const size = textStyle?.fontSize;
  if (isFontSizeKey(size)) out = <span className={`atrium-size-${size}`}>{out}</span>;
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

/** The `class` and `dir` a paragraph or heading gets from its align and dir keys (others are ignored). */
function blockProps(node: DocNode): { className?: string; dir?: 'ltr' | 'rtl' } {
  const align = node.attrs?.align;
  const dir = node.attrs?.dir;
  return {
    className: isAlignKey(align) ? `atrium-align-${align}` : undefined,
    dir: isDirKey(dir) ? dir : undefined,
  };
}

/** A table cell's span, only when it is a small whole number. */
const span = (value: unknown): number | undefined =>
  Number.isInteger(value) && (value as number) > 1 && (value as number) <= MAX_SPAN
    ? (value as number)
    : undefined;

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
      return (
        <p key={key} {...blockProps(node)}>
          {renderChildren(node, depth)}
        </p>
      );
    case 'heading':
      // The composer has one heading level; any other is shown as its text.
      return node.attrs?.level === 2 ? (
        <h2 key={key} {...blockProps(node)}>
          {renderChildren(node, depth)}
        </h2>
      ) : (
        <Fragment key={key}>{plainText(node)}</Fragment>
      );
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{plainText(node)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'table':
      return (
        <div key={key} className={styles.tableScroll}>
          <table>
            <tbody>{renderChildren(node, depth)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{renderChildren(node, depth)}</tr>;
    case 'tableHeader':
      return (
        <th key={key} colSpan={span(node.attrs?.colspan)} rowSpan={span(node.attrs?.rowspan)}>
          {renderChildren(node, depth)}
        </th>
      );
    case 'tableCell':
      return (
        <td key={key} colSpan={span(node.attrs?.colspan)} rowSpan={span(node.attrs?.rowspan)}>
          {renderChildren(node, depth)}
        </td>
      );
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
