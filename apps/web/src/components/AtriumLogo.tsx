import { useId } from 'react';

/**
 * Atrium mark: four rounded tiles in a pinwheel around an open courtyard. Original artwork.
 * `variant="onDark"` renders the wordmark text in white for the sidebar.
 */
export function AtriumMark({ size = 32, title }: { size?: number; title?: string }) {
  const titleId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-labelledby={title ? titleId : undefined}
      focusable="false"
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <rect x="2" y="2" width="16" height="9" rx="3.5" fill="var(--illus-indigo)" />
      <rect x="21" y="2" width="9" height="16" rx="3.5" fill="var(--illus-teal)" />
      <rect x="14" y="21" width="16" height="9" rx="3.5" fill="var(--illus-orange)" />
      <rect x="2" y="14" width="9" height="16" rx="3.5" fill="var(--illus-pink)" />
    </svg>
  );
}

export function AtriumLogo({
  size = 28,
  variant = 'default',
}: {
  size?: number;
  variant?: 'default' | 'onDark';
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.35),
        color: variant === 'onDark' ? 'var(--atrium-white)' : 'var(--primary-text-color)',
        font: `var(--atrium-font-weight-semibold) ${Math.round(size * 0.66)}px/1 var(--title-font-family)`,
      }}
    >
      <AtriumMark size={size} />
      <span>Atrium</span>
    </span>
  );
}
