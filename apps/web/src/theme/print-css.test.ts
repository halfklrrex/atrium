import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/theme/print.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Index of the brace that closes the block opened at `open`. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces');
}

/** Top-level at-rules and rules as [prelude, body]. */
function topLevel(text: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const close = closingBrace(text, open);
    out.push([text.slice(i, open).trim(), text.slice(open + 1, close)]);
    i = close + 1;
  }
  return out;
}

const blocks = topLevel(css);
const printBody = blocks.find(([prelude]) => prelude === '@media print')?.[1] ?? '';

describe('theme/print.css', () => {
  it('has nothing at the top level except @page rules and one @media print block', () => {
    const others = blocks.filter(([prelude]) => !prelude.startsWith('@page'));
    expect(others.map(([prelude]) => prelude)).toEqual(['@media print']);
  });

  it('prints the board table on a landscape named page, and only that page', () => {
    const named = blocks.find(([prelude]) => prelude === '@page board-table');
    expect(named?.[1]).toMatch(/size:\s*landscape/);
    // The unnamed @page rule must not force an orientation on the item view or a dashboard.
    const plain = blocks.find(([prelude]) => prelude === '@page');
    expect(plain?.[1]).not.toMatch(/size:/);
    expect(printBody).toMatch(/page:\s*board-table/);
  });

  it('hides the app shell and the dialogs, which carry data-print="hide"', () => {
    expect(printBody).toMatch(/\[data-print='hide'\][^{]*\{[^}]*display:\s*none/);
    expect(printBody).toMatch(/\.monday-style-dialog-content-wrapper/);
  });

  it('lets scroll containers grow instead of clipping', () => {
    expect(printBody).toMatch(/\[data-print='reset'\][^{]*\{[^}]*overflow:\s*visible/);
    expect(printBody).toMatch(/\[data-print='reset'\][^{]*\{[^}]*height:\s*auto/);
  });

  it('forces black on white for every theme', () => {
    for (const theme of ['light', 'dark', 'black']) {
      expect(printBody).toContain(`html.${theme}-app-theme`);
    }
    expect(printBody).toMatch(/--primary-text-color:\s*#000/);
    expect(printBody).toMatch(/--primary-background-color:\s*#fff/);
  });

  it('keeps rows and dashboard widgets whole across pages', () => {
    expect(printBody).toMatch(/\[role='row'\][^{]*\{[^}]*break-inside:\s*avoid/);
    expect(printBody).toMatch(/\[data-widget-id\][^{]*\{[^}]*break-inside:\s*avoid/);
  });
});
