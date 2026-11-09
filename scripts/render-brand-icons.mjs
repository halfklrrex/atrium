// Renders the master icon SVGs to PNGs (64, 128, 192 px, light and dark) and builds
// apps/web/public/favicon.ico (16, 32, 48 px). WebKit draws SVG filter output at low resolution,
// so the app shows these PNGs instead of the SVG art. Run: node scripts/render-brand-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { repoRoot } from './env.mjs';

const require = createRequire(resolve(repoRoot, 'tests/visual/package.json'));
const { chromium } = require('@playwright/test');

const brand = resolve(repoRoot, 'apps/web/src/assets/brand');
const sizes = [64, 128, 192];
const icoSizes = [16, 32, 48];

const browser = await chromium.launch();
async function render(svgFile, size, scale) {
  const svg = readFileSync(svgFile, 'utf8');
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: scale,
  });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true, type: 'png' });
  await page.close();
  return png;
}

for (const theme of ['light', 'dark']) {
  const svgFile = resolve(brand, `atrium-icon-${theme}.svg`);
  for (const size of sizes) {
    const png = await render(svgFile, size, 1);
    writeFileSync(resolve(brand, `atrium-icon-${theme}-${size}.png`), png);
  }
}

const icoImages = [];
for (const size of icoSizes) {
  icoImages.push({ size, png: await render(resolve(brand, 'atrium-icon-light.svg'), size, 1) });
}
await browser.close();

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);
const dir = Buffer.alloc(16 * icoImages.length);
let offset = header.length + dir.length;
icoImages.forEach(({ size, png }, i) => {
  dir.writeUInt8(size, i * 16);
  dir.writeUInt8(size, i * 16 + 1);
  dir.writeUInt16LE(1, i * 16 + 4);
  dir.writeUInt16LE(32, i * 16 + 6);
  dir.writeUInt32LE(png.length, i * 16 + 8);
  dir.writeUInt32LE(offset, i * 16 + 12);
  offset += png.length;
});
writeFileSync(
  resolve(repoRoot, 'apps/web/public/favicon.ico'),
  Buffer.concat([header, dir, ...icoImages.map((i) => i.png)]),
);
console.log('done');
