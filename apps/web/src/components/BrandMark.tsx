import markUrl from '../assets/brand/atrium-mark.svg';
import iconDarkUrl from '../assets/brand/atrium-icon-dark.svg';
import iconLightUrl from '../assets/brand/atrium-icon-light.svg';
import styles from './BrandMark.module.css';

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
      <img className={styles.iconLight} src={iconLightUrl} alt="" aria-hidden {...dim} />
      <img className={styles.iconDark} src={iconDarkUrl} alt="" aria-hidden {...dim} />
    </span>
  );
}
