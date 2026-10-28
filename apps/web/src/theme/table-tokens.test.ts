import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/theme/table-tokens.css'), 'utf8');

/** `--name: value` declarations inside the rule whose selector is exactly `selector`. */
function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return {};
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

const WHITE = '#ffffff'; // --atrium-white, the colour of --atrium-table-on-fill
const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: '.dark-app-theme,\n.black-app-theme' },
  { name: 'black', selector: '.black-app-theme' },
];

describe('table tokens', () => {
  it('uses white for the on-fill text', () => {
    expect(declarations(':root')['--atrium-table-on-fill']).toBe('var(--atrium-white)');
  });

  it.each(THEMES)(
    'keeps the white timeline label at 4.5:1 or better on the track in the $name theme',
    (theme) => {
      const light = declarations(':root')['--atrium-timeline-track']!;
      const shared = declarations('.dark-app-theme,\n.black-app-theme')['--atrium-timeline-track'];
      const own =
        theme.name === 'black'
          ? declarations('.black-app-theme')['--atrium-timeline-track']
          : undefined;
      const track = theme.name === 'light' ? light : (own ?? shared ?? light);
      expect(track, theme.name).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(WHITE, track), theme.name).toBeGreaterThanOrEqual(4.5);
    },
  );
});
