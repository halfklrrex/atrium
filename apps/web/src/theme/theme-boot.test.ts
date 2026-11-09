import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ThemePreference } from '@atrium/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, resolveTheme, THEME_COLORS } from './theme';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const bootScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function setMedia(dark: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches: dark,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function reset() {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  document.head.innerHTML = '<meta name="theme-color" content="#edf1fc">';
  localStorage.clear();
}

function snapshot() {
  return {
    cls: document.documentElement.className,
    scheme: document.documentElement.style.colorScheme,
    color: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  };
}

describe('index.html boot script', () => {
  beforeEach(reset);
  afterEach(() => vi.unstubAllGlobals());

  it('is the first script in the document and has no module/src', () => {
    expect(bootScript).toContain('atrium.theme');
    expect(html.indexOf(bootScript)).toBeLessThan(html.indexOf('src/main.tsx'));
  });

  const stored: (ThemePreference | 'none' | 'garbage' | 'unknown')[] = [
    'system',
    'light',
    'dark',
    'black',
    'none',
    'garbage',
    'unknown',
  ];
  for (const prefersDark of [false, true]) {
    for (const value of stored) {
      it(`matches applyTheme for ${value} (OS dark: ${String(prefersDark)})`, () => {
        setMedia(prefersDark);
        if (value === 'garbage') localStorage.setItem('atrium.theme', '{nope');
        else if (value === 'unknown')
          localStorage.setItem(
            'atrium.theme',
            JSON.stringify({ state: { preference: 'neon' }, version: 1 }),
          );
        else if (value !== 'none')
          localStorage.setItem(
            'atrium.theme',
            JSON.stringify({ state: { preference: value }, version: 1 }),
          );
        new Function(bootScript)();
        const booted = snapshot();

        reset();
        const preference: ThemePreference =
          value === 'none' || value === 'garbage' || value === 'unknown' ? 'system' : value;
        applyTheme(resolveTheme(preference, prefersDark));
        expect(booted).toEqual(snapshot());
      });
    }
  }

  it('does not throw when storage is unavailable', () => {
    setMedia(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => new Function(bootScript)()).not.toThrow();
    vi.restoreAllMocks();
  });

  it('uses the colours in THEME_COLORS', () => {
    for (const color of Object.values(THEME_COLORS)) expect(bootScript).toContain(color);
  });
});
