import type { SubIcon } from '@vibe/core';

/** Nine-dot "app switcher" glyph (Vibe ships no equivalent). Original artwork, 20px grid. */
const DOTS = [4, 10, 16];

export const AppGridIcon: SubIcon = ({ className, size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="currentColor"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {DOTS.flatMap((cy) => DOTS.map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" />))}
  </svg>
);
