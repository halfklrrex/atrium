import { existsSync, readFileSync } from 'node:fs';
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
      expect.arrayContaining(['/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png']),
    );
  });

  it.each(hrefs)('%s exists in apps/web/public', (href) => {
    expect(href.startsWith('/')).toBe(true);
    expect(existsSync(resolve(webRoot, 'public', href.slice(1)))).toBe(true);
  });
});
