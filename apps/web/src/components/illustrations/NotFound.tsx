import { Svg, type IllustrationProps } from './Svg';

/** An open courtyard arch with a path leading through it. */
export function NotFound(props: IllustrationProps) {
  return (
    <Svg box={[250, 120]} {...props}>
      <ellipse cx="125" cy="66" rx="112" ry="48" fill="var(--illus-glow)" />
      {/* flanking tiles */}
      <rect x="28" y="62" width="44" height="40" rx="10" fill="var(--illus-pink)" opacity="0.9" />
      <rect
        x="40"
        y="72"
        width="20"
        height="5"
        rx="2.5"
        fill="var(--illus-on-accent)"
        opacity="0.8"
      />
      <rect x="178" y="48" width="44" height="54" rx="10" fill="var(--illus-teal)" opacity="0.9" />
      <rect
        x="190"
        y="58"
        width="20"
        height="5"
        rx="2.5"
        fill="var(--illus-on-accent)"
        opacity="0.8"
      />
      {/* arch */}
      <path
        d="M85 106V56a40 40 0 0 1 80 0v50Z"
        fill="var(--illus-shadow)"
        transform="translate(0 3)"
      />
      <path d="M85 106V56a40 40 0 0 1 80 0v50Z" fill="var(--illus-indigo)" />
      <path d="M99 106V57a26 26 0 0 1 52 0v49Z" fill="var(--illus-glow)" />
      {/* path through the doorway */}
      <path d="m111 106 8-32h12l8 32Z" fill="var(--illus-surface)" stroke="var(--illus-line)" />
      <path
        d="M125 79v6M125 91v6"
        stroke="var(--illus-line)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="125" cy="54" r="8" fill="var(--illus-orange)" />
      <path d="M62 106h126" stroke="var(--illus-line)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="46" cy="30" r="3.5" fill="var(--illus-orange)" />
      <circle cx="208" cy="26" r="3" fill="var(--illus-pink)" />
    </Svg>
  );
}
