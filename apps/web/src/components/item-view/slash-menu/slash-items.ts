import type { Editor } from '@tiptap/react';
import {
  Bullets,
  CheckList,
  Code,
  Divider,
  Quote,
  Table,
  Text,
  TextBig,
  TextMedium,
  TextSmall,
} from '@vibe/icons';
import { NumberedList, type EditorIcon } from '../editor-icons';

interface Range {
  from: number;
  to: number;
}

export interface SlashItem {
  id: string;
  title: string;
  /** Shown to the right of the title: the markdown shortcut. */
  hint: string;
  /** Extra words the filter matches besides the title. */
  keywords: string[];
  Icon: EditorIcon;
  /** Runs with the `/query` range; every item deletes it first. */
  run: (editor: Editor, range: Range) => void;
}

const start = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'text',
    title: 'Text',
    hint: 'Plain paragraph',
    keywords: ['paragraph', 'normal'],
    Icon: Text,
    run: (e, r) => start(e, r).setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    hint: '#',
    keywords: ['h1', 'title', 'large'],
    Icon: TextBig,
    run: (e, r) => start(e, r).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: '##',
    keywords: ['h2', 'subtitle', 'medium'],
    Icon: TextMedium,
    run: (e, r) => start(e, r).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: '###',
    keywords: ['h3', 'small'],
    Icon: TextSmall,
    run: (e, r) => start(e, r).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bullets',
    title: 'Bulleted list',
    hint: '-',
    keywords: ['ul', 'unordered', 'bullets'],
    Icon: Bullets,
    run: (e, r) => start(e, r).toggleBulletList().run(),
  },
  {
    id: 'numbers',
    title: 'Numbered list',
    hint: '1.',
    keywords: ['ol', 'ordered', 'numbers'],
    Icon: NumberedList,
    run: (e, r) => start(e, r).toggleOrderedList().run(),
  },
  {
    id: 'checklist',
    title: 'Checklist',
    hint: '[ ]',
    keywords: ['todo', 'task', 'checkbox'],
    Icon: CheckList,
    run: (e, r) => start(e, r).toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    hint: '>',
    keywords: ['blockquote', 'citation'],
    Icon: Quote,
    run: (e, r) => start(e, r).toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    hint: '```',
    keywords: ['pre', 'snippet'],
    Icon: Code,
    run: (e, r) => start(e, r).toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    hint: '---',
    keywords: ['hr', 'rule', 'line', 'separator'],
    Icon: Divider,
    run: (e, r) => start(e, r).setHorizontalRule().run(),
  },
  {
    id: 'table',
    title: 'Table',
    hint: '3 x 3',
    keywords: ['grid', 'rows', 'columns'],
    Icon: Table,
    run: (e, r) => start(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

/** Items whose title or keywords contain the query (case-insensitive); all of them when empty. */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
  );
}
