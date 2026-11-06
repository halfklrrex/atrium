import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TWEMOJI_BASE_URL,
  detectFlagSupport,
  flagSupport,
  isFlagEmoji,
  needsFlagImage,
  resetFlagSupportForTests,
  twemojiUrl,
} from './flag-emoji';

const FR = '\u{1F1EB}\u{1F1F7}';
const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';

/** A fake document whose canvas measures text with `widthOf` and draws `pixelsOf(text)`. */
function fakeDoc(opts: {
  widthOf?: (text: string) => number;
  pixelsOf?: (text: string) => number[];
  noContext?: boolean;
  throws?: boolean;
}) {
  let last = '';
  const getContext = vi.fn(() => {
    if (opts.throws) throw new Error('no canvas');
    if (opts.noContext) return null;
    return {
      font: '',
      textBaseline: '',
      measureText: (t: string) => ({ width: (opts.widthOf ?? (() => 10))(t) }),
      clearRect: () => undefined,
      fillText: (t: string) => {
        last = t;
      },
      getImageData: () => ({ data: new Uint8ClampedArray((opts.pixelsOf ?? (() => [1]))(last)) }),
    };
  });
  const doc = { createElement: () => ({ getContext }) } as unknown as Document;
  return { doc, getContext };
}

afterEach(() => resetFlagSupportForTests());

describe('isFlagEmoji and twemojiUrl', () => {
  it('recognises country and subdivision flags only', () => {
    expect(isFlagEmoji(FR)).toBe(true);
    expect(isFlagEmoji(ENGLAND)).toBe(true);
    expect(isFlagEmoji('\u{1F600}')).toBe(false);
    expect(isFlagEmoji('\u{1F3C1}')).toBe(false);
    expect(isFlagEmoji('FR')).toBe(false);
  });

  it('builds the picture URL from the code points', () => {
    expect(twemojiUrl(FR)).toBe(`${TWEMOJI_BASE_URL}1f1eb-1f1f7.svg`);
    expect(twemojiUrl(ENGLAND)).toBe(
      `${TWEMOJI_BASE_URL}1f3f4-e0067-e0062-e0065-e006e-e0067-e007f.svg`,
    );
  });
});

describe('detectFlagSupport', () => {
  it('reports native support without a document or a canvas context', () => {
    expect(detectFlagSupport(undefined)).toEqual({ regional: true, subdivision: true });
    expect(detectFlagSupport(fakeDoc({ noContext: true }).doc)).toEqual({
      regional: true,
      subdivision: true,
    });
    expect(detectFlagSupport(fakeDoc({ throws: true }).doc)).toEqual({
      regional: true,
      subdivision: true,
    });
  });

  it('detects a joined pair as supported', () => {
    const { doc } = fakeDoc({ widthOf: (t) => (t === FR ? 12 : 10), pixelsOf: (t) => [t.length] });
    expect(detectFlagSupport(doc)).toEqual({ regional: true, subdivision: true });
  });

  it('detects two separate letters as unsupported', () => {
    const { doc } = fakeDoc({ widthOf: (t) => (t === FR ? 20 : 10) });
    expect(detectFlagSupport(doc)).toEqual({ regional: false, subdivision: false });
  });

  it('detects subdivision flags drawn like the plain black flag as unsupported', () => {
    const { doc } = fakeDoc({ pixelsOf: () => [5, 5] });
    expect(detectFlagSupport(doc)).toEqual({ regional: true, subdivision: false });
  });
});

describe('needsFlagImage', () => {
  it('is false in jsdom (no canvas) and for non-flags', () => {
    expect(flagSupport()).toEqual({ regional: true, subdivision: true });
    expect(needsFlagImage(FR)).toBe(false);
    expect(needsFlagImage('\u{1F600}')).toBe(false);
  });
});
