import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/theme/scrollbar-tokens.css'), 'utf8');

describe('scrollbar tokens', () => {
  it.each([
    '--atrium-scrollbar-size',
    '--atrium-scrollbar-size-table',
    '--atrium-scrollbar-thumb',
    '--atrium-scrollbar-thumb-hover',
    '--atrium-scrollbar-radius',
  ])('defines %s', (name) => {
    expect(css).toContain(`${name}:`);
  });
});
