import type { ReactNode } from 'react';

export interface IllustrationProps {
  /** Rendered width in px; the height follows the artwork's aspect ratio. */
  width?: number;
  className?: string;
}

/**
 * Shared frame for the original empty-state artwork: decorative, scales from its viewBox and takes
 * every colour from the `--illus-*` tokens so it follows the light, dark and black themes.
 */
export function Svg({
  box: [w, h],
  width = w,
  className,
  children,
}: IllustrationProps & { box: readonly [number, number]; children: ReactNode }) {
  return (
    <svg
      width={width}
      height={Math.round((width * h) / w)}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
