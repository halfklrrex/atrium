import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/theme/emoji-tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const require = createRequire(import.meta.url);
const vibeTokens = readFileSync(require.resolve('@vibe/core/tokens'), 'utf8');

/** Normalises a font stack: no quotes, no spaces after commas. */
function stack(value: string): string {
  return value
    .replace(/['"]/g, '')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

function declared(source: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(source);
  expect(match, `${name} is declared`).not.toBeNull();
  return match![1]!;
}

describe('Atrium Emoji font', () => {
  it('declares an @font-face for a woff2 file that exists in public/fonts', () => {
    const face = /@font-face\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(face).toMatch(/font-family:\s*'Atrium Emoji'/);
    expect(face).toMatch(/font-display:\s*swap/);
    const src = /url\('([^']+)'\)\s*format\('woff2'\)/.exec(face)?.[1];
    expect(src).toBe('/fonts/atrium-emoji.woff2');
    expect(existsSync(join(process.cwd(), 'public', src!))).toBe(true);
  });

  it('limits the font to emoji code points with a unicode-range', () => {
    const range = /unicode-range:\s*([^;]+);/.exec(css)?.[1] ?? '';
    expect(range).toContain('U+FE0F');
    expect(range).toContain('U+1F1E6-1F1FF');
    // Plain text stays in the text font: ASCII digits, #, * and letters are not in the range.
    expect(range).not.toMatch(/U\+(23|2A|3\d|4\d|6\d)\b/);
  });

  it('puts Atrium Emoji first in both font stacks, ahead of Vibe', () => {
    expect(declared(css, '--font-family')).toMatch(
      /^'Atrium Emoji',\s*var\(--atrium-vibe-font-family\)$/,
    );
    expect(declared(css, '--title-font-family')).toMatch(
      /^'Atrium Emoji',\s*var\(--atrium-vibe-title-font-family\)$/,
    );
  });

  it("keeps Vibe's own stacks, so the copy cannot drift from @vibe/core", () => {
    expect(stack(declared(css, '--atrium-vibe-font-family'))).toBe(
      stack(declared(vibeTokens, '--font-family')),
    );
    expect(stack(declared(css, '--atrium-vibe-title-font-family'))).toBe(
      stack(declared(vibeTokens, '--title-font-family')),
    );
  });
});

describe('no third-party emoji requests', () => {
  it('has no source file that references jsdelivr or twemojiUrl', () => {
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) visit(path);
        else if (
          /\.(tsx?|css|html)$/.test(name) &&
          name !== 'emoji-tokens.test.ts' &&
          /jsdelivr|twemojiUrl/i.test(readFileSync(path, 'utf8'))
        )
          offenders.push(path);
      }
    };
    visit(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});
