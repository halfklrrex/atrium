import type { ChainedCommands } from '@tiptap/react';

/** The text-style (¶) menu rows, shared by the description toolbar and the update composer. */
export type StyleKey = 'normal' | 'h1' | 'h2' | 'h3' | 'quote' | 'code';

export const TEXT_STYLES: {
  key: StyleKey;
  name: string;
  preview: 'styleNormal' | 'styleH1' | 'styleH2' | 'styleH3' | 'styleQuote' | 'styleCode';
  apply: (chain: ChainedCommands) => void;
}[] = [
  {
    key: 'normal',
    name: 'Normal text',
    preview: 'styleNormal',
    apply: (c) => c.setParagraph().run(),
  },
  {
    key: 'h1',
    name: 'Heading 1',
    preview: 'styleH1',
    apply: (c) => c.setNode('heading', { level: 1 }).run(),
  },
  {
    key: 'h2',
    name: 'Heading 2',
    preview: 'styleH2',
    apply: (c) => c.setNode('heading', { level: 2 }).run(),
  },
  {
    key: 'h3',
    name: 'Heading 3',
    preview: 'styleH3',
    apply: (c) => c.setNode('heading', { level: 3 }).run(),
  },
  { key: 'quote', name: 'Quote', preview: 'styleQuote', apply: (c) => c.toggleBlockquote().run() },
  {
    key: 'code',
    name: 'Code block',
    preview: 'styleCode',
    apply: (c) => c.toggleCodeBlock().run(),
  },
];
