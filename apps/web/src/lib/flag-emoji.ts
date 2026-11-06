/**
 * Flag emoji picture fallback. Windows has no flag glyphs: a regional-indicator pair such as 🇫🇷
 * shows as the letters "FR", and a subdivision flag (England, Scotland, Wales) as a plain black
 * flag. On such platforms flags are drawn as Twemoji pictures from a CDN instead; everywhere else
 * they stay plain text and nothing is fetched. Licence and attribution: docs/PROVENANCE.md.
 */

/**
 * Where the flag pictures come from: the maintained Twemoji fork (graphics CC-BY 4.0) on jsDelivr,
 * pinned to an exact release. The only external host this feature uses (docs/architecture.md §4).
 */
export const TWEMOJI_BASE_URL = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/';

const REGIONAL_FLAG = /^\p{Regional_Indicator}{2}$/u;
const SUBDIVISION_FLAG = /^\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}$/u;

/** True for a country flag (a regional-indicator pair) or a subdivision flag (a tag sequence). */
export function isFlagEmoji(emoji: string): boolean {
  return REGIONAL_FLAG.test(emoji) || SUBDIVISION_FLAG.test(emoji);
}

/** The Twemoji picture URL for an emoji: its code points in lowercase hex, joined by `-`. */
export function twemojiUrl(emoji: string): string {
  // Twemoji's file names drop the variation selector unless the sequence has a zero-width joiner.
  const chars = emoji.includes('\u200d') ? emoji : emoji.replace(/\ufe0f/g, '');
  const name = [...chars].map((c) => c.codePointAt(0)!.toString(16)).join('-');
  return `${TWEMOJI_BASE_URL}${name}.svg`;
}

export interface FlagSupport {
  /** The platform joins a regional-indicator pair into one flag glyph. */
  regional: boolean;
  /** The platform draws subdivision flags (tag sequences). */
  subdivision: boolean;
}

const NATIVE: FlagSupport = { regional: true, subdivision: true };
const EMOJI_FONT =
  '32px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
const SIZE = 40;

function pixels(ctx: CanvasRenderingContext2D, text: string): Uint8ClampedArray {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillText(text, 0, 0);
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Measures whether this platform draws flag emoji, on a scratch canvas. Without a document or a
 * 2D canvas (server rendering, jsdom) or on any error it reports native support, so nothing is
 * fetched. Uncached; use `flagSupport()`.
 */
export function detectFlagSupport(doc: Document | undefined = globalThis.document): FlagSupport {
  try {
    if (!doc) return NATIVE;
    const canvas = doc.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return NATIVE;
    ctx.font = EMOJI_FONT;
    ctx.textBaseline = 'top';
    // A joined pair is one glyph about as wide as a single letter; unjoined it is two letters.
    const pair = ctx.measureText('\u{1F1EB}\u{1F1F7}').width;
    const letter = ctx.measureText('\u{1F1EB}').width;
    const regional = !(letter > 0 && pair > letter * 1.5);
    if (!regional) return { regional, subdivision: false };
    // Without tag-sequence support England draws exactly like the bare black flag.
    const england = pixels(ctx, '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}');
    const black = pixels(ctx, '\u{1F3F4}');
    return { regional, subdivision: !samePixels(england, black) };
  } catch {
    return NATIVE;
  }
}

let cached: FlagSupport | undefined;

/** `detectFlagSupport()`, measured once per page load. */
export function flagSupport(): FlagSupport {
  cached ??= detectFlagSupport();
  return cached;
}

/** True when this emoji is a flag the platform cannot draw, so it should be a picture. */
export function needsFlagImage(emoji: string): boolean {
  if (REGIONAL_FLAG.test(emoji)) return !flagSupport().regional;
  if (SUBDIVISION_FLAG.test(emoji)) return !flagSupport().subdivision;
  return false;
}

/** Clears the cached measurement (tests only). */
export function resetFlagSupportForTests(): void {
  cached = undefined;
}
