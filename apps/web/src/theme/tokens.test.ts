import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_COLORS } from './palette';

// Vitest runs with the package root (apps/web) as the working directory.
const srcDir = join(process.cwd(), 'src');
const vibeCss = readFileSync(
  join(process.cwd(), 'node_modules/@vibe/core/dist/tokens/tokens.css'),
  'utf8',
);

/** All `--name:` custom property declarations in a stylesheet. */
const declared = (css: string): Set<string> =>
  new Set([...css.matchAll(/(--[a-z0-9_-]+)\s*:/gi)].map((m) => m[1]!));

/** All `var(--name` references in a stylesheet. */
const used = (css: string): Set<string> =>
  new Set([...css.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)].map((m) => m[1]!));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

describe('design tokens', () => {
  it('only uses Vibe tokens that exist in the installed @vibe/core', () => {
    const known = declared(vibeCss);
    const local = new Set<string>();
    const references = new Map<string, string[]>();
    for (const file of cssFiles(srcDir)) {
      const css = readFileSync(file, 'utf8');
      declared(css).forEach((name) => local.add(name));
      used(css).forEach((name) => references.set(name, [...(references.get(name) ?? []), file]));
    }
    // Per-element custom properties that components set inline from data (group colour, tree depth...).
    const inline = new Set(['--group-color', '--depth', '--progress']);
    const missing = [...references.keys()].filter(
      (name) => !known.has(name) && !local.has(name) && !inline.has(name),
    );
    expect(missing).toEqual([]);
  });

  it('takes every z-index from the --atrium-z-* stacking scale', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(srcDir)) {
      if (file.includes(join('src', 'theme'))) continue; // the scale itself lives here
      for (const [, value] of readFileSync(file, 'utf8').matchAll(/z-index\s*:\s*([^;}]+)/g)) {
        // `--atrium-z-*` (the scale) or a `--atrium-table-z-*` alias of it (table-tokens.css).
        if (!/^(var\(--atrium-(table-)?z-|calc\(var\(--atrium-z-)/.test(value!.trim())) {
          offenders.push(`${file}: z-index: ${value!.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps floating layers above every in-page layer', () => {
    const tokens = readFileSync(join(srcDir, 'theme', 'tokens.css'), 'utf8');
    const z = (name: string) =>
      Number(new RegExp(String.raw`--atrium-z-${name}:\s*(\d+)`).exec(tokens)?.[1]);
    const order = [
      'raised',
      'sticky',
      'chrome',
      'batch',
      'scrim',
      'nav',
      'panel',
      'drawer',
      'popover',
      'dropdown',
      'modal',
      'toast',
    ];
    const values = order.map(z);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    // Sticky table layers use sticky+1 and sticky+2 (table-tokens.css): still under the sidebar handle.
    expect(z('sticky') + 2).toBeLessThan(z('chrome'));
    // Every Vibe dialog wrapper (MenuButton, Tooltip) gets the dropdown tier from index.css.
    const index = readFileSync(join(srcDir, 'index.css'), 'utf8');
    expect(index).toMatch(
      /\.monday-style-dialog-content-wrapper\s*\{\s*z-index:\s*var\(--atrium-z-dropdown\)/,
    );
  });

  it('has a palette whose colours mirror Vibe colour tokens', () => {
    expect(WORKSPACE_COLORS).toHaveLength(10);
    for (const color of WORKSPACE_COLORS) {
      const match = new RegExp(`--color-${color.name}:\\s*(#[0-9a-f]{6})`, 'i').exec(vibeCss);
      expect(match?.[1]?.toLowerCase(), `--color-${color.name}`).toBe(color.hex.toLowerCase());
    }
  });
});
