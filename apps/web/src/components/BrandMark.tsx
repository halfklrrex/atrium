import markUrl from '../assets/brand/atrium-mark.svg';
import dark64 from '../assets/brand/atrium-icon-dark-64.png';
import dark128 from '../assets/brand/atrium-icon-dark-128.png';
import dark192 from '../assets/brand/atrium-icon-dark-192.png';
import light64 from '../assets/brand/atrium-icon-light-64.png';
import light128 from '../assets/brand/atrium-icon-light-128.png';
import light192 from '../assets/brand/atrium-icon-light-192.png';
import styles from './BrandMark.module.css';

// WebKit draws SVG filter output at low resolution, so the icon ships as PNGs at 1x, 2x and 3x
// (rendered from the master SVGs by scripts/render-brand-icons.mjs).
const iconLightSrcSet = `${light64} 1x, ${light128} 2x, ${light192} 3x`;
const iconDarkSrcSet = `${dark64} 1x, ${dark128} 2x, ${dark192} 3x`;

/**
 * The Atrium logo: a glazed atrium with a gable roof of translucent panes and a warm floor glow.
 * Own artwork (see docs/PROVENANCE.md). `variant="mark"` is the transparent mark for small
 * placements on any background; `variant="icon"` is the full app icon with its tile, in the
 * light or dark version to match the active theme (the theme is a class on `<html>`).
 * Pass `title` for the accessible name; without it the image is decorative.
 */
export function BrandMark({
  size = 32,
  variant = 'mark',
  title,
}: {
  size?: number;
  variant?: 'mark' | 'icon';
  title?: string;
}) {
  const alt = title ?? '';
  const dim = { width: size, height: size };
  if (variant === 'mark') {
    return (
      <img
        className={styles.mark}
        src={markUrl}
        alt={alt}
        aria-hidden={title ? undefined : true}
        {...dim}
      />
    );
  }
  return (
    <span
      className={styles.icon}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <img
        className={styles.iconLight}
        src={light192}
        srcSet={iconLightSrcSet}
        alt=""
        aria-hidden
        {...dim}
      />
      <img
        className={styles.iconDark}
        src={dark192}
        srcSet={iconDarkSrcSet}
        alt=""
        aria-hidden
        {...dim}
      />
    </span>
  );
}
