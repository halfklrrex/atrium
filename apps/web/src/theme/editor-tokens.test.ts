import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOR_KEYS, FONT_KEYS } from '../components/item-view/editor-palette';

const css = readFileSync(join(process.cwd(), 'src/theme/editor-tokens.css'), 'utf8');

/** `--name: #rrggbb` declarations inside the rule whose selector is `selector`. */
function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} rule`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// Vibe's --primary-background-color in each theme.
const THEMES = [
  { name: 'light', selector: ':root', background: '#ffffff' },
  { name: 'dark', selector: '.dark-app-theme', background: '#181b34' },
  { name: 'black', selector: '.black-app-theme', background: '#111111' },
];

describe('editor tokens', () => {
  const light = declarations(':root');

  it('defines a text colour and a highlight for every palette key, and a font per font key', () => {
    for (const key of COLOR_KEYS) {
      expect(light[`--atrium-text-${key}`], key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(light[`--atrium-highlight-${key}`], key).toContain('color-mix');
      expect(css).toContain(`.atrium-text-${key} {`);
      expect(css).toContain(`.atrium-highlight-${key} {`);
    }
    for (const key of FONT_KEYS) {
      expect(light[`--atrium-font-${key}`], key).toBeTruthy();
      expect(css).toContain(`.atrium-font-${key} {`);
    }
  });

  it.each(THEMES)('keeps every text colour at 4.5:1 or better in the $name theme', (theme) => {
    const overrides = theme.selector === ':root' ? {} : declarations(theme.selector);
    for (const key of COLOR_KEYS) {
      const value = overrides[`--atrium-text-${key}`] ?? light[`--atrium-text-${key}`]!;
      expect(contrast(value, theme.background), `${key} in ${theme.name}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
