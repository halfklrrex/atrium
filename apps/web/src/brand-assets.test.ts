import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = resolve(__dirname, '..');
const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8');

describe('index.html icons', () => {
  const hrefs = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map(
    (m) => /href="([^"]+)"/.exec(m[0])?.[1] ?? '',
  );

  it('links an SVG favicon, PNG fallbacks and an apple touch icon', () => {
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/favicon.svg?v=2',
        '/favicon.ico?v=2',
        '/favicon-32.png?v=2',
        '/apple-touch-icon.png?v=2',
      ]),
    );
  });

  it.each(hrefs)('%s is versioned and exists in apps/web/public', (href) => {
    expect(href.startsWith('/')).toBe(true);
    expect(href).toMatch(/\?v=\d+$/);
    expect(existsSync(resolve(webRoot, 'public', href.slice(1).replace(/\?.*$/, '')))).toBe(true);
  });

  it('ships a real multi-size favicon.ico (16, 32 and 48 px)', () => {
    const ico = readFileSync(resolve(webRoot, 'public/favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + i * 16));
    expect(sizes).toEqual([16, 32, 48]);
  });
});

describe('brand icon art', () => {
  const brand = resolve(webRoot, 'src/assets/brand');

  it.each(['light', 'dark'])('the %s SVG has no malformed percentages', (theme) => {
    const svg = readFileSync(resolve(brand, `atrium-icon-${theme}.svg`), 'utf8');
    expect(svg).not.toContain('%%');
  });

  it.each(['light', 'dark'].flatMap((t) => [64, 128, 192].map((s) => [t, s] as const)))(
    'the %s icon PNG exists at %i px',
    (theme, size) => {
      const png = readFileSync(resolve(brand, `atrium-icon-${theme}-${size}.png`));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    },
  );
});

describe('firebase.json page caching', () => {
  const config = JSON.parse(readFileSync(resolve(webRoot, '../../firebase.json'), 'utf8'));
  const app = config.hosting.find((h: { target: string }) => h.target === 'app');
  const rules: { source: string; headers: { key: string; value: string }[] }[] = app.headers;
  const index = (source: string) => rules.findIndex((r) => r.source === source);
  const cache = (source: string) =>
    rules[index(source)]?.headers.find((h) => h.key === 'Cache-Control')?.value;

  it('serves every page, including / and deep links, with no-cache', () => {
    expect(cache('**')).toBe('no-cache');
  });

  it('keeps hashed assets immutable and icons at one day, later rules winning over the page rule', () => {
    expect(cache('/assets/**')).toBe('public, max-age=31536000, immutable');
    expect(cache('**/*.@(ico|svg|png)')).toBe('public, max-age=86400');
    expect(index('**')).toBeLessThan(index('**/*.@(ico|svg|png)'));
    expect(index('**/*.@(ico|svg|png)')).toBeLessThan(index('/assets/**'));
  });
});

describe('self-hosted fonts', () => {
  const fontsDir = resolve(webRoot, 'src', 'theme', 'fonts');
  const sheets = readdirSync(fontsDir).filter((f) => f.endsWith('.css'));

  it('index.html makes no request to Google Fonts', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('no source file references Google Fonts', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.(tsx?|css|html)$/.test(entry.name) &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.endsWith('.test.tsx') &&
          /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(path, 'utf8'))
        ) {
          offenders.push(path);
        }
      }
    };
    walk(resolve(webRoot, 'src'));
    expect(offenders).toEqual([]);
  });

  it('preloads only fonts that exist', () => {
    const hrefs = [...html.matchAll(/<link[^>]+rel="preload"[^>]*>/g)].map(
      (m) => /href="([^"]+)"/.exec(m[0])?.[1] ?? '',
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs)
      expect(existsSync(resolve(webRoot, href.replace(/^\//, '')))).toBe(true);
  });

  it('has the core and editor stylesheets', () => {
    expect(sheets).toEqual(
      expect.arrayContaining([
        'core.css',
        'lora.css',
        'nunito.css',
        'jetbrains-mono.css',
        'caveat.css',
        'poppins.css',
      ]),
    );
  });

  it.each(sheets)('%s: every @font-face has a woff2 file, swap and a unicode-range', (sheet) => {
    const css = readFileSync(resolve(fontsDir, sheet), 'utf8');
    const faces = css.split('@font-face').slice(1);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const file = /url\('\.\/([^']+\.woff2)'\)/.exec(face)?.[1];
      expect(file, face).toBeDefined();
      expect(existsSync(resolve(fontsDir, file ?? ''))).toBe(true);
      expect(face).toContain('font-display: swap');
      expect(face).toContain('unicode-range:');
    }
  });
});
